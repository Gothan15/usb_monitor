import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  verifyPasswordFast,
  simulatePasswordCheckDelay,
  createSessionToken,
  hashPassword,
} from "@/lib/auth";
import { hit } from "@/lib/rateLimit";

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json();
    if (typeof username !== "string" || typeof password !== "string") {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "INVALID_PAYLOAD", message: "Formato inválido" },
        },
        { status: 400 }
      );
    }
    // Rate limit por IP + usuario
    const ip =
      (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      "unknown";
    const rlKey = `login:${ip}`;
    const rlUserKey = `login:${ip}:${username}`;
    const rl = hit(rlKey, { windowMs: 5 * 60_000, max: 30 }); // 30 intentos IP/5min
    const rlUser = hit(rlUserKey, { windowMs: 5 * 60_000, max: 5 }); // 5 intentos usuario/5min
    if (!rl.allowed || !rlUser.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "RATE_LIMIT", message: "Demasiados intentos" },
        },
        { status: 429 }
      );
    }

    const user = await (db as any).user.findUnique({ where: { username } });
    if (!user) {
      await simulatePasswordCheckDelay();
      return NextResponse.json(
        {
          ok: false,
          error: { code: "BAD_CREDENTIALS", message: "Credenciales inválidas" },
        },
        { status: 401 }
      );
    }
    // Verificar lockout
    if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "LOCKED", message: "Cuenta temporalmente bloqueada" },
        },
        { status: 423 }
      );
    }
    const verification = await verifyPasswordFast(password, user.passwordHash);
    if (!verification.valid) {
      // incrementar intentos fallidos
      const updated = await (db as any).user.update({
        where: { id: user.id },
        data: {
          failedAttempts: (user.failedAttempts || 0) + 1,
          lockedUntil:
            (user.failedAttempts || 0) + 1 >= 7
              ? new Date(Date.now() + 15 * 60_000)
              : null,
        },
        select: { failedAttempts: true },
      });
      return NextResponse.json(
        {
          ok: false,
          error: { code: "BAD_CREDENTIALS", message: "Credenciales inválidas" },
        },
        { status: 401 }
      );
    }
    // Reset intentos fallidos
    if (user.failedAttempts > 0 || user.lockedUntil) {
      try {
        await (db as any).user.update({
          where: { id: user.id },
          data: { failedAttempts: 0, lockedUntil: null },
        });
      } catch {}
    }
    // Rehash progresivo si es scrypt válido
    if (verification.needsRehash) {
      try {
        const newHash = await hashPassword(password);
        await (db as any).user.update({
          where: { id: user.id },
          data: { passwordHash: newHash },
        });
      } catch (e) {
        console.warn("No se pudo rehash password", e);
      }
    }
    // Emitir cookie de sesión simple
    const token = createSessionToken(user.id, user.apiKey);
    const isProd = process.env.NODE_ENV === "production";
    const cookieFlags = [
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      "Max-Age=3600",
    ];
    if (isProd) cookieFlags.push("Secure");
    const response = NextResponse.json({
      ok: true,
      user: { id: user.id, username: user.username },
      // Frontend ya no necesita guardar nada; token sólo en cookie
    });
    response.headers.append(
      "Set-Cookie",
      `session=${token}; ${cookieFlags.join("; ")}`
    );
    return response;
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "SERVER_ERROR", message: e.message || "Error interno" },
      },
      { status: 500 }
    );
  }
}
