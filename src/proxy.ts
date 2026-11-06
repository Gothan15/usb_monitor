import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { buildContentSecurityPolicy, parseAllowedOrigins } from "./lib/csp";

const dev = process.env.NODE_ENV !== "production";
const shouldEnforceHttps =
  (process.env.ENFORCE_HTTPS_REDIRECT ?? "true") !== "false";
const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

function nombreDelHost(host: string | null): string {
  if (!host) return "";
  const limpio = host.trim().toLowerCase();
  if (limpio.startsWith("[")) {
    // IPv6 con puerto: [::1]:3000
    const cierre = limpio.indexOf("]");
    return cierre > 0 ? limpio.slice(1, cierre) : limpio;
  }
  return limpio.split(":")[0];
}

function esIpv4PrivadaOlocal(nombre: string): boolean {
  const partes = nombre.split(".").map(Number);
  if (partes.length !== 4 || partes.some((n) => Number.isNaN(n))) {
    return false;
  }
  const [a, b] = partes;
  return (
    a === 127 || // loopback
    a === 10 || // privada
    (a === 172 && b >= 16 && b <= 31) || // privada
    (a === 192 && b === 168) || // privada
    (a === 169 && b === 254) // enlace local
  );
}

/**
 * El panel vive en la red local: el acceso por localhost, por un
 * nombre .local o por una IP privada llega por HTTP a propósito
 * (el TLS en LAN es la excepción, con Caddy o CA interna). Forzar
 * HTTPS en esos destinos —redirección 308 o la directiva CSP
 * upgrade-insecure-requests— dejaba el panel inalcanzable desde
 * cualquier otro ordenador de la red cuando el servidor solo habla
 * HTTP: en localhost no se notaba porque el navegador lo trata
 * como origen de confianza y lo exime.
 */
export function esHostLocalODeLan(host: string | null): boolean {
  const nombre = nombreDelHost(host);
  if (!nombre) return false;
  if (
    nombre === "localhost" ||
    nombre.endsWith(".localhost") ||
    nombre.endsWith(".local")
  ) {
    return true;
  }
  if (nombre === "::1") return true;
  return esIpv4PrivadaOlocal(nombre);
}

function isHttps(req: NextRequest) {
  const forwardedProto = req.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    const proto = forwardedProto.split(",")[0]?.trim().toLowerCase();
    if (proto) {
      return proto === "https";
    }
  }
  return req.nextUrl.protocol === "https:";
}

function generateNonce() {
  const raw = crypto.randomUUID().replace(/-/g, "");
  if (typeof btoa === "function") {
    return btoa(raw);
  }
  return raw;
}

export function proxy(req: NextRequest) {
  const host = req.headers.get("host");
  // En destinos de la LAN o del propio equipo no se fuerza HTTPS:
  // el panel se sirve por HTTP dentro de la red local.
  const destinoLocalOLan = esHostLocalODeLan(host);
  if (!dev && shouldEnforceHttps && !destinoLocalOLan && !isHttps(req)) {
    if (host) {
      const url = new URL(
        req.nextUrl.pathname + req.nextUrl.search,
        `https://${host}`
      );
      return NextResponse.redirect(url, 308);
    }
  }

  const nonce = generateNonce();
  const contentSecurityPolicy = buildContentSecurityPolicy({
    allowedOrigins,
    development: dev,
    nonce,
    upgradeInsecureRequests: shouldEnforceHttps && !destinoLocalOLan,
  });

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  response.headers.set("x-nonce", nonce);

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
