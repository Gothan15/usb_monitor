import { NextResponse } from "next/server";
import {
  buildCsrfCookie,
  buildSessionCookie,
  createSessionToken,
  renewSessionToken,
  requireAuth,
  issueCsrfToken,
} from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const auth = await requireAuth(req, { enforceCsrf: false });

    // Obtener información del usuario para incluir el rol
    const user = await (db as any).user.findUnique({
      where: { id: auth.userId },
      select: { username: true, role: true },
    });
    const normalizedRole =
      typeof user?.role === "string" ? user.role.toLowerCase() : user?.role;

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

    let rotated = false;
    const cookiesToSet: string[] = [];
    const existingSession = cookies.session;
    if (existingSession) {
      const renewed = renewSessionToken(existingSession);
      if (renewed && renewed !== existingSession) {
        cookiesToSet.push(buildSessionCookie(renewed));
        rotated = true;
      }
    }
    if (!rotated && auth.sessionNeedsRotation) {
      const freshToken = createSessionToken(auth.userId, auth.apiKey);
      cookiesToSet.push(buildSessionCookie(freshToken));
      rotated = true;
    }
    const payload = {
      ok: true,
      user: {
        id: auth.userId,
        username: user?.username,
        role: normalizedRole ?? null,
      },
      renewed: rotated,
    };
    const res = NextResponse.json(payload);
    if (rotated) {
      const csrfToken = issueCsrfToken();
      cookiesToSet.push(buildCsrfCookie(csrfToken));
      res.headers.set("X-CSRF-Token", csrfToken);
    }
    for (const cookie of cookiesToSet) {
      res.headers.append("Set-Cookie", cookie);
    }
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "No autenticado" } },
      { status: error?.message === "FORBIDDEN" ? 403 : 401 }
    );
  }
}
