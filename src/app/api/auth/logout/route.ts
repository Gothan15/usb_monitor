import { NextResponse } from "next/server";
import { expireCsrfCookie, expireSessionCookie, requestIsSecure, requireAuth, subirVersionSesion } from "@/lib/auth";

export async function POST(req: Request) {
  let auth;
  try {
    auth = await requireAuth(req);
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: "No autorizado" },
      { status: error?.message === "FORBIDDEN" ? 403 : 401 }
    );
  }

  // Cerrar sesión de verdad: subir la versión deja el token
  // inservible aunque alguien conserve la cookie.
  if (auth?.type === "user") {
    await subirVersionSesion(auth.userId).catch(() => {});
  }

  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", expireSessionCookie(requestIsSecure(req)));
  res.headers.append("Set-Cookie", expireCsrfCookie(requestIsSecure(req)));
  res.headers.set("Cache-Control", "no-store");
  return res;
}
