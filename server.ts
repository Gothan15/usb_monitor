// server.ts - Next.js Standalone + Socket.IO
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import next from "next";
import nextPackage from "next/package.json" with { type: "json" };
import { Server } from "socket.io";
import { withContainer } from "@/lib/di/container";
import { logError, logInfo, logWarn } from "@/lib/logger";
import { setupSocket } from "@/lib/socket";

const dev = process.env.NODE_ENV !== "production";
const currentPort = Number(process.env.PORT);
const hostname = process.env.APP_HOST;
const nextVersion = (nextPackage as { version?: string }).version ?? "dev";

// Orígenes por defecto del socket: localhost y el nombre interno.
// Los orígenes reales de la red (la IP del servidor en la LAN) se
// definen con ALLOWED_ORIGINS o con APP_PUBLIC_HOST (p. ej.
// la IP del hotspot); nada de IPs de una red concreta en el código.
const APP_PUBLIC_HOST = (process.env.APP_PUBLIC_HOST || "").trim();
const DEFAULT_SOCKET_ORIGINS = [
  "https://usbmonitor.local",
  "http://localhost:3000",
  "https://localhost:3000",
  ...(APP_PUBLIC_HOST
    ? [`http://${APP_PUBLIC_HOST}:3000`, `https://${APP_PUBLIC_HOST}:3000`]
    : []),
];

function parseSocketOrigins() {
  const raw = process.env.ALLOWED_ORIGINS ?? "";
  const entries = raw
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    return DEFAULT_SOCKET_ORIGINS;
  }
  return Array.from(new Set(entries));
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

function getNetworkAddress() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const detail of entries) {
      if (!detail || detail.internal) continue;
      const family = detail.family;
      if (family !== "IPv4") continue;
      if (!detail.address || detail.address.startsWith("169.254.")) continue;
      return detail.address;
    }
  }
  return null;
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

    const requestHandler = (
      req: Parameters<typeof handle>[0],
      res: Parameters<typeof handle>[1],
    ) => {
      if (req.url?.startsWith("/api/socketio")) {
        return;
      }
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

    const allowedOrigins = parseSocketOrigins();

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
      const networkAddress = getNetworkAddress();
      const mode = tlsOptions ? "TLS • HTTP/1.1" : "HTTP/1.1";

      const localUrl = `${protocol}://${displayHost}:${currentPort}`;
      const networkUrl = networkAddress
        ? `${protocol}://${networkAddress}:${currentPort}`
        : undefined;

      logInfo(`Next.js ${nextVersion}`, {
        Local: localUrl,
        ...(networkUrl ? { Network: networkUrl } : {}),
        Modo: mode,
      });

      const socketProtocol = protocol === "https" ? "wss" : "ws";
      const localSocket = `${socketProtocol}://${displayHost}:${currentPort}/api/socketio`;
      const networkSocket = networkAddress
        ? `${socketProtocol}://${networkAddress}:${currentPort}/api/socketio`
        : undefined;

      logInfo("Socket.IO", {
        Local: localSocket,
        ...(networkSocket ? { Network: networkSocket } : {}),
        Orígenes: allowedOrigins,
      });
      if (!tlsOptions && !dev) {
        logWarn("TLS no configurado. El tráfico se sirve por HTTP.");
      }
    });
  } catch (err) {
    logError("Error al iniciar servidor", err);
    process.exit(1);
  }
}

// Start the server
createCustomServer();
