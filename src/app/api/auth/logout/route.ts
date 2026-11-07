import { NextResponse } from "next/server";
import { expireCsrfCookie, expireSessionCookie, requestIsSecure, requireAuth } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    await requireAuth(req);
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: "No autorizado" },
      { status: error?.message === "FORBIDDEN" ? 403 : 401 }
    );
  }

  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", expireSessionCookie(requestIsSecure(req)));
  res.headers.append("Set-Cookie", expireCsrfCookie(requestIsSecure(req)));
  res.headers.set("Cache-Control", "no-store");
  return res;
}
