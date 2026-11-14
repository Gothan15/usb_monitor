// server.ts - Next.js Standalone + Socket.IO
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import fs from "node:fs";
import path from "node:path";
import next from "next";
import nextPackage from "next/package.json" with { type: "json" };
import { Server } from "socket.io";
import { imprimirBannerPanel } from "./src/lib/banner";
import {
  direccionPrincipal,
  direccionesIpv4Locales,
  origenesDeDireccion,
} from "./src/lib/direccionesLocales";
import { withContainer } from "@/lib/di/container";
import { iniciarLatidoDepuracionAgente } from "@/lib/agentDebug";
import { recuperarTareasInterrumpidas } from "@/lib/installExecutor";
import { logError, logInfo, logWarn } from "@/lib/logger";
import { setupSocket } from "@/lib/socket";

const dev = process.env.NODE_ENV !== "production";
const currentPort = Number(process.env.PORT);
// Sin APP_HOST expreso, el panel escucha en TODAS las interfaces:
// es un panel de red local y tiene que responder también por la IP
// de la LAN (otros ordenadores y los agentes de otros PCs). Fijar
// APP_HOST=127.0.0.1 o localhost lo encerraría en el propio equipo.
const hostname = (process.env.APP_HOST || "").trim() || "0.0.0.0";
const nextVersion = (nextPackage as { version?: string }).version ?? "dev";

// UNA sola dirección de acceso al panel: la del propio equipo
// por su ruta por defecto, la que le asigna el DHCP a su
// adaptador de red. Ni localhost, ni el nombre interno, ni las
// demás interfaces (Tailscale, adaptadores virtuales…): entrar
// al panel es entrar por esa dirección. Se descubre al
// arrancar, así que un cambio de IP por DHCP no pide tocar el
// .env. APP_PUBLIC_HOST y ALLOWED_ORIGINS siguen valiendo para
// sumar una dirección u orígenes a mano si algún día hicieran
// falta; sin ellos, la lista es la dirección y nada más.
const APP_PUBLIC_HOST = (process.env.APP_PUBLIC_HOST || "").trim();
const PUERTO_SOCKET = Number(process.env.PORT) || 3000;

function parseSocketOrigins(direccionPanel: string) {
  const porDefecto = [
    ...origenesDeDireccion(direccionPanel, PUERTO_SOCKET),
    ...(APP_PUBLIC_HOST
      ? [
          `http://${APP_PUBLIC_HOST}:${PUERTO_SOCKET}`,
          `https://${APP_PUBLIC_HOST}:${PUERTO_SOCKET}`,
        ]
      : []),
  ];
  const raw = process.env.ALLOWED_ORIGINS ?? "";
  const entries = raw
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    return porDefecto;
  }
  // ALLOWED_ORIGINS AÑADE orígenes a los de por defecto, no los
  // sustituye: sustituirlos dejaba fuera hasta la dirección
  // del panel y el canal en vivo se caía sin aviso.
  return Array.from(new Set([...porDefecto, ...entries]));
}

/**
 * Los Host que el navegador puede traer al pedir el panel: los
 * de los orígenes permitidos, con puerto y sin él. Lo que no
 * sea /api (el canal de los agentes va firmado y entra por la
 * dirección que cada agente tenga guardada) y no traiga uno de
 * estos Host no está pidiendo el panel: está pidiendo otra
 * dirección del mismo equipo.
 */
function hostsPermitidos(origenes: string[]): Set<string> {
  const hosts = new Set<string>();
  for (const origen of origenes) {
    try {
      const url = new URL(origen);
      hosts.add(url.host);
      hosts.add(url.hostname);
    } catch {
      // Un origen mal escrito en el .env no tumba el arranque.
    }
  }
  return hosts;
}

function readFileMaybe(filePath: string | undefined) {
  if (!filePath) return undefined;
  try {
    const resolved = path.isAbsolute(filePath)
      ? filePath
      : path.join(process.cwd(), filePath);
    return fs.readFileSync(resolved);
  } catch (error) {
    logWarn("No se pudo leer archivo TLS", { filePath, error });
    return undefined;
  }
}

function buildTlsOptions() {
  const keyPath = process.env.TLS_KEY_PATH;
  const certPath = process.env.TLS_CERT_PATH;
  const keyInline = process.env.TLS_KEY;
  const certInline = process.env.TLS_CERT;

  const key = keyInline ? Buffer.from(keyInline) : readFileMaybe(keyPath);
  const cert = certInline ? Buffer.from(certInline) : readFileMaybe(certPath);

  if (key && cert) {
    return { key, cert };
  }
  if (key || cert) {
    logWarn("Configuración TLS incompleta. Se usará HTTP sin cifrar.");
  }
  return undefined;
}

// Custom server with Socket.IO integration
async function createCustomServer() {
  try {
    // Create Next.js app
    const nextApp = next({
      dev,
      dir: process.cwd(),
      // In production, use the current directory where .next is located
      conf: dev ? undefined : { distDir: "./.next" },
    });

    await nextApp.prepare();
    const handle = nextApp.getRequestHandler();

    const tlsOptions = buildTlsOptions();
    const protocol = tlsOptions ? "https" : "http";

    // La dirección única de acceso: la de la ruta por defecto
    // (la del DHCP). Sin ruta, la primera dirección del equipo;
    // sin ninguna, localhost — nunca una lista vacía que deje
    // el panel sin ninguna puerta.
    const direccionPanel =
      (await direccionPrincipal()) ??
      direccionesIpv4Locales()[0] ??
      "localhost";
    const allowedOrigins = parseSocketOrigins(direccionPanel);
    const hostsDelPanel = hostsPermitidos(allowedOrigins);

    const requestHandler = (
      req: Parameters<typeof handle>[0],
      res: Parameters<typeof handle>[1],
    ) => {
      if (req.url?.startsWith("/api/socketio")) {
        return;
      }
      // Una sola dirección de acceso: si el navegador pide el
      // panel por otra dirección de este equipo (localhost,
      // Tailscale…), se le dice cuál es la buena en vez de
      // servirle un panel a medias. Las rutas /api no entran
      // aquí: los agentes hablan firmado y llegan por la
      // dirección que tengan configurada.
      if (!req.url?.startsWith("/api/")) {
        const host = req.headers.host;
        if (host && !hostsDelPanel.has(host)) {
          res.writeHead(403, {
            "Content-Type": "text/plain; charset=utf-8",
          });
          res.end(
            `El panel solo se sirve en ${protocol}://${direccionPanel}:${PUERTO_SOCKET}.`,
          );
          return;
        }
      }
      // La IP verdadera del cliente, tomada del socket: las rutas
      // la leen como x-client-ip (el login la usa para comprobar
      // la PC asignada). Una cabecera puesta por el navegador no
      // serviría: cualquiera podría decir que viene de otra PC.
      const ipSocket = req.socket?.remoteAddress;
      if (ipSocket) req.headers["x-client-ip"] = ipSocket;
      handle(req, res);
    };

    const baseServer = tlsOptions
      ? createHttpsServer(tlsOptions, requestHandler)
      : createHttpServer(requestHandler);

    baseServer.on("error", (error) => {
      logError("Fallo en servidor HTTP(S)", error);
    });

    // Create HTTP server that will handle both Next.js and Socket.IO
    const server = baseServer;

    const corsOrigin = (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      logWarn("Intento de conexión Socket.IO bloqueado por CORS", {
        origin,
      });
      return callback(new Error("Socket origin not allowed"));
    };

    // Setup Socket.IO
    const io = new Server(server, {
      path: "/api/socketio",
      cors: {
        origin: corsOrigin,
        methods: ["GET", "POST"],
        credentials: true,
      },
    });

    withContainer(() => {
      setupSocket(io);
    });

    // Start the server
    server.listen(currentPort, hostname, () => {
      const displayHost =
        hostname && hostname !== "0.0.0.0" && hostname !== "::"
          ? hostname
          : "localhost";
      const networkAddress = direccionPanel;
      const mode = tlsOptions ? "TLS • HTTP/1.1" : "HTTP/1.1";

      const localUrl = `${protocol}://${displayHost}:${currentPort}`;
      const networkUrl = networkAddress
        ? `${protocol}://${networkAddress}:${currentPort}`
        : undefined;

      imprimirBannerPanel({
        versionNext: nextVersion,
        local: localUrl,
        red: networkUrl,
        modo: mode,
        // El aviso va DENTRO de la portada, como una fila más:
        // nada de líneas sueltas bajo la caja.
        aviso:
          !tlsOptions && !dev
            ? "TLS no configurado. El tráfico se sirve por HTTP."
            : undefined,
      });
    });
  } catch (err) {
    logError("Error al iniciar servidor", err);
    process.exit(1);
  }
}

// Latido de depuración agente↔servidor: solo imprime si
// USB_MONITOR_DEBUG=1; sin el modo activo no sale nada nuevo.
iniciarLatidoDepuracionAgente();

// Tareas de instalación que un reinicio dejó a medias: sus
// destinos quedan marcados INTERRUMPIDO (la clave solo vive en
// memoria; el reintento la pedirá otra vez).
void recuperarTareasInterrumpidas();

// Start the server
createCustomServer();
