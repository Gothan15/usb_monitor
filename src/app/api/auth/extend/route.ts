import { NextResponse } from "next/server";
import {
  buildCsrfCookie,
  buildSessionCookie,
  createSessionToken,
  issueCsrfToken,
  requireAuth,
} from "@/lib/auth";
import { getCurrentTimestamp } from "@/lib/time";
import { logError } from "@/lib/logger";

export async function POST(req: Request) {
  try {
    const auth = await requireAuth(req);
    let requestedTtl: number | undefined;
    try {
      const body = await req.json().catch(() => ({}));
      if (body && typeof body.ttlSeconds === "number") {
        requestedTtl = body.ttlSeconds;
      }
    } catch {}

    const DEFAULT_TTL = 60 * 60; // 1h
    const MAX_TTL = 4 * 60 * 60; // 4h
    const ttl = Math.min(Math.max(requestedTtl || DEFAULT_TTL, 300), MAX_TTL);
    const token = createSessionToken(auth.userId, auth.apiKey, ttl);
    const csrfToken = issueCsrfToken();
    const now = Math.floor(getCurrentTimestamp() / 1000);
    const res = NextResponse.json({ ok: true, expiresAt: now + ttl });
    res.headers.append("Set-Cookie", buildSessionCookie(token, ttl));
    res.headers.append("Set-Cookie", buildCsrfCookie(csrfToken, ttl));
    res.headers.set("X-CSRF-Token", csrfToken);
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    if (error?.code === "CSRF_MISSING" || error?.code === "CSRF_INVALID") {
      return NextResponse.json({ error: "CSRF inválido" }, { status: 403 });
    }
    if (error?.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (error?.message === "FORBIDDEN") {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    }
    logError("Error extendiendo sesión", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
