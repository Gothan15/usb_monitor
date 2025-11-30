import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { buildContentSecurityPolicy, parseAllowedOrigins } from "./lib/csp";

const dev = process.env.NODE_ENV !== "production";
const shouldEnforceHttps =
  (process.env.ENFORCE_HTTPS_REDIRECT ?? "true") !== "false";
const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

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

export function middleware(req: NextRequest) {
  if (!dev && shouldEnforceHttps && !isHttps(req)) {
    const host = req.headers.get("host");
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
