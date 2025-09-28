import { NextResponse } from "next/server";
import { authenticateRequest, createSessionToken } from "@/lib/auth";

export async function POST(req: Request) {
  const auth = await authenticateRequest(req);
  if (!auth)
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  // Permite solicitar extensión de sesión con un TTL opcional (seguro y acotado)
  let requestedTtl: number | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    if (body && typeof body.ttlSeconds === "number")
      requestedTtl = body.ttlSeconds;
  } catch {}
  const DEFAULT_TTL = 60 * 60; // 1h
  const MAX_TTL = 4 * 60 * 60; // 4h
  const ttl = Math.min(Math.max(requestedTtl || DEFAULT_TTL, 300), MAX_TTL);
  const token = createSessionToken(auth.userId, auth.apiKey, ttl);
  const isProd = process.env.NODE_ENV === "production";
  const flags = ["Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${ttl}`];
  if (isProd) flags.push("Secure");
  const now = Math.floor(Date.now() / 1000);
  const res = NextResponse.json({ ok: true, expiresAt: now + ttl });
  res.headers.append("Set-Cookie", `session=${token}; ${flags.join("; ")}`);
  return res;
}
