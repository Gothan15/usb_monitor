import { NextResponse } from "next/server";
import {
  buildCsrfCookie,
  buildSessionCookie,
  requestIsSecure,
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
        .split(";")
        .map((c) => c.trim())
        .filter(Boolean)
        .map((c) => {
          const [k, ...r] = c.split("=");
          return [decodeURIComponent(k), decodeURIComponent(r.join("="))];
        }),
    );

    let rotated = false;
    const cookiesToSet: string[] = [];
    const existingSession = cookies.session;
    if (existingSession) {
      const renewed = renewSessionToken(existingSession);
      if (renewed && renewed !== existingSession) {
        cookiesToSet.push(buildSessionCookie(renewed, undefined, requestIsSecure(req)));
        rotated = true;
      }
    }
    if (!rotated && auth.sessionNeedsRotation) {
      const freshToken = createSessionToken(auth.userId, auth.apiKey, undefined, auth.sessionVersion ?? 1);
      cookiesToSet.push(buildSessionCookie(freshToken, undefined, requestIsSecure(req)));
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
    // La cookie CSRF se repone si la sesión rotó O si la
    // petición no traía ninguna: sin ella, el navegador no
    // puede adjuntar la cabecera que exigen los POST y TODAS
    // las acciones de administración mueren con CSRF_MISSING
    // hasta volver a iniciar sesión (la cookie puede perderse
    // —caducidad propia, limpieza del navegador— con la sesión
    // aún viva). Reponerla aquí, en la comprobación de sesión
    // que la interfaz hace al cargar, cura ese estado solo.
    if (rotated || !cookies["csrf-token"]) {
      const csrfToken = issueCsrfToken();
      cookiesToSet.push(buildCsrfCookie(csrfToken, undefined, requestIsSecure(req)));
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
      { status: error?.message === "FORBIDDEN" ? 403 : 401 },
    );
  }
}
