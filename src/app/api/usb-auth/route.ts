import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  hashPassword,
  simulatePasswordCheckDelay,
  verifyPassword,
} from "@/lib/auth";

const MAX_FAILED_ATTEMPTS = Number(
  process.env.USB_MONITOR_MAX_FAILED_ATTEMPTS || 5
);
const LOCK_DURATION_MINUTES = Number(
  process.env.USB_MONITOR_LOCK_MINUTES || 15
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password } = body ?? {};

    if (!username || !password) {
      return NextResponse.json(
        {
          authorized: false,
          message: "Debe proporcionar usuario y contraseña.",
        },
        { status: 400 }
      );
    }

    const normalizedUsername = String(username).trim();
    if (!normalizedUsername) {
      return NextResponse.json(
        {
          authorized: false,
          message: "Usuario inválido.",
        },
        { status: 400 }
      );
    }

    const comparableUsernames = Array.from(
      new Set([
        normalizedUsername,
        normalizedUsername.toLowerCase(),
        normalizedUsername.toUpperCase(),
      ])
    );

    const candidates = await db.user.findMany({
      where: {
        username: {
          in: comparableUsernames,
        },
      },
    });

    const user = candidates.find(
      (candidate) =>
        candidate.username.trim().toLowerCase() ===
        normalizedUsername.toLowerCase()
    );

    if (!user) {
      await simulatePasswordCheckDelay();
      return NextResponse.json(
        {
          authorized: false,
          message: "Credenciales incorrectas.",
        },
        { status: 401 }
      );
    }

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      const minutesLeft = Math.ceil(
        (user.lockedUntil.getTime() - now.getTime()) / 60000
      );
      return NextResponse.json(
        {
          authorized: false,
          message: `Cuenta bloqueada. Intente nuevamente en ${minutesLeft} minuto(s).`,
        },
        { status: 423 }
      );
    }

    const { valid, needsRehash } = await verifyPassword(
      password,
      user.passwordHash
    );

    if (!valid) {
      const updatedAttempts = user.failedAttempts + 1;
      const data: Record<string, unknown> = {
        failedAttempts: updatedAttempts,
      };

      if (updatedAttempts >= MAX_FAILED_ATTEMPTS) {
        data.failedAttempts = 0;
        data.lockedUntil = new Date(
          now.getTime() + LOCK_DURATION_MINUTES * 60000
        );
      }

      await db.user.update({
        where: { id: user.id },
        data,
      });

      return NextResponse.json(
        {
          authorized: false,
          message: "Credenciales incorrectas.",
        },
        { status: 401 }
      );
    }

    const updateData: Record<string, unknown> = {
      failedAttempts: 0,
      lockedUntil: null,
    };

    if (needsRehash) {
      updateData.passwordHash = await hashPassword(password);
    }

    await db.user.update({
      where: { id: user.id },
      data: updateData,
    });

    return NextResponse.json({
      authorized: true,
      message: "Credenciales verificadas correctamente.",
      username: user.username,
    });
  } catch (error) {
    console.error("Error en /api/usb-auth:", error);
    return NextResponse.json(
      {
        authorized: false,
        message: "Error interno del servidor.",
      },
      { status: 500 }
    );
  }
}
