import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  verifyPasswordFast,
  simulatePasswordCheckDelay,
  createSessionToken,
  hashPassword,
  buildSessionCookie,
  buildCsrfCookie,
  issueCsrfToken,
} from "@/lib/auth";
import { hit } from "@/lib/rateLimit";
import { addMillisecondsToNow, getCurrentTimestamp } from "@/lib/time";
import { logError } from "@/lib/logger";

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
    const rl = await hit(rlKey, { windowMs: 5 * 60_000, max: 30 }, { ip });
    const rlUser = await hit(
      rlUserKey,
      { windowMs: 5 * 60_000, max: 5 },
      { ip, identifier: username.toLowerCase() }
    );
    if (!rl.allowed || !rlUser.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "RATE_LIMIT", message: "Demasiados intentos" },
        },
        { status: 429 }
      );
    }

    const user = await (db as any).user.findUnique({
      where: { username },
      include: { computer: true },
    });
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

    // Rol 'agent' eliminado: solo 'admin' y 'user'.

    // Validar que usuarios normales solo puedan iniciar sesión desde su PC asignada
    const normalizedRole =
      typeof user.role === "string" ? user.role.toLowerCase() : user.role;

    if (normalizedRole === "user" && user.computer) {
      // Obtener el hostname de la computadora cliente
      const clientHostname = req.headers.get("x-client-hostname");

      // Validar que el hostname coincida (case-insensitive)
      if (
        clientHostname &&
        clientHostname.toUpperCase() !== user.computer.name.toUpperCase()
      ) {
        await simulatePasswordCheckDelay();
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: "WRONG_COMPUTER",
              message: `Solo puede iniciar sesión desde la computadora asignada: ${user.computer.name}`,
              details: {
                assignedComputer: user.computer.name,
                attemptedComputer: clientHostname,
              },
            },
          },
          { status: 403 }
        );
      }
    }
    // Verificar lockout
    if (
      user.lockedUntil &&
      new Date(user.lockedUntil).getTime() > getCurrentTimestamp()
    ) {
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
              ? addMillisecondsToNow(15 * 60_000)
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
    const csrfToken = issueCsrfToken();
    const response = NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        role: normalizedRole ?? null,
      },
      // Frontend ya no necesita guardar nada; token sólo en cookie
    });
    response.headers.append("Set-Cookie", buildSessionCookie(token));
    response.headers.append("Set-Cookie", buildCsrfCookie(csrfToken));
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-CSRF-Token", csrfToken);
    return response;
  } catch (e: any) {
    logError("Error en inicio de sesión", e);
    return NextResponse.json(
      {
        ok: false,
        error: { code: "SERVER_ERROR", message: "Error interno" },
      },
      { status: 500 }
    );
  }
}
