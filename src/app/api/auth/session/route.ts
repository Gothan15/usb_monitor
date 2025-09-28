import { NextResponse } from "next/server";
import {
  authenticateRequest,
  sessionInternal,
  renewSessionToken,
  createSessionToken,
} from "@/lib/auth";

export async function GET(req: Request) {
  const auth = await authenticateRequest(req);
  if (!auth)
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "No autenticado" } },
      { status: 401 }
    );
  // Renovar cookie de sesión (opcional sliding)
  const cookieHeader = req.headers.get("cookie") || "";
  const cookies = Object.fromEntries(
    cookieHeader
      .split(/; */)
      .filter(Boolean)
      .map((c) => {
        const [k, ...r] = c.split("=");
        return [decodeURIComponent(k), decodeURIComponent(r.join("="))];
      })
  );
  let refreshed = false;
  if (cookies.session) {
    const renewed = renewSessionToken(cookies.session);
    if (renewed) {
      const isProd = process.env.NODE_ENV === "production";
      const flags = ["Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=3600"];
      if (isProd) flags.push("Secure");
      const res = NextResponse.json({ ok: true, user: auth, renewed: true });
      res.headers.append(
        "Set-Cookie",
        `session=${renewed}; ${flags.join("; ")}`
      );
      return res;
    }
  }
  return NextResponse.json({ ok: true, user: auth, renewed: refreshed });
}
