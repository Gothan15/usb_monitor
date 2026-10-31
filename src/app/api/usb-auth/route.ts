import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  hashPassword,
  simulatePasswordCheckDelay,
  verifyPassword,
} from "@/lib/auth";
import { getCurrentDate } from "@/lib/time";
import { readAppSettings } from "@/lib/appSettings";

const MAX_FAILED_ATTEMPTS = Number(
  process.env.USB_MONITOR_MAX_FAILED_ATTEMPTS || 5
);
const LOCK_DURATION_MINUTES = Number(
  process.env.USB_MONITOR_LOCK_MINUTES || 15
);

const GENERIC_DENIED = {
  authorized: false,
  message: "No autorizado.",
} as const;

async function recordAttempt(data: {
  pendingId?: string | null;
  pcName: string;
  usernameTried: string;
  userId?: string | null;
  serialNumber?: string | null;
  result: string;
  origin?: string;
}) {
  try {
    await db.unlockAttempt.create({
      data: {
        pendingId: data.pendingId ?? null,
        pcName: data.pcName,
        usernameTried: data.usernameTried,
        userId: data.userId ?? null,
        serialNumber: data.serialNumber ?? null,
        result: data.result,
        origin: data.origin ?? "ONLINE",
      },
    });
  } catch (error) {
    // La auditoría nunca debe tumbar la verificación.
    console.error("No se pudo registrar el intento de desbloqueo:", error);
  }
}

async function findUser(normalizedUsername: string) {
  const comparableUsernames = Array.from(
    new Set([
      normalizedUsername,
      normalizedUsername.toLowerCase(),
      normalizedUsername.toUpperCase(),
    ])
  );
  const candidates = await db.user.findMany({
    where: { username: { in: comparableUsernames } },
    include: { computer: { select: { id: true, name: true } } },
  });
  return (
    candidates.find(
      (candidate) =>
        candidate.username.trim().toLowerCase() ===
        normalizedUsername.toLowerCase()
    ) ?? null
  );
}

/** Registra un fallo de contraseña y aplica el bloqueo si toca. */
async function registerFailedAttempt(
  user: { id: string; failedAttempts: number },
  now: Date
) {
  const updatedAttempts = user.failedAttempts + 1;
  const data: Record<string, unknown> = { failedAttempts: updatedAttempts };
  if (updatedAttempts >= MAX_FAILED_ATTEMPTS) {
    data.failedAttempts = 0;
    data.lockedUntil = new Date(now.getTime() + LOCK_DURATION_MINUTES * 60000);
  }
  await db.user.update({ where: { id: user.id }, data });
}

async function registerSuccess(
  user: { id: string },
  password: string,
  needsRehash: boolean
) {
  const updateData: Record<string, unknown> = {
    failedAttempts: 0,
    lockedUntil: null,
  };
  if (needsRehash) {
    updateData.passwordHash = await hashPassword(password);
  }
  await db.user.update({ where: { id: user.id }, data: updateData });
}

/**
 * Flujo 2FA: hay pcName. Se comprueba, en orden: que exista un
 * dispositivo bloqueado en esa PC, la contraseña, y que el usuario sea
 * el dueño de esa PC o un admin. Toda denegación responde lo mismo.
 */
async function handleDeviceUnlock(body: any, pcName: string) {
  const { username, password } = body;
  const driveLetter =
    typeof body.driveLetter === "string" && body.driveLetter.trim()
      ? body.driveLetter.trim()
      : null;
  const serialNumber =
    typeof body.serialNumber === "string" && body.serialNumber.trim()
      ? body.serialNumber.trim()
      : null;
  const usernameTried = String(username ?? "").trim();

  // Fase 5: interruptor general del panel. Si el desbloqueo por
  // contraseña está desactivado, ningún dispositivo se libera con
  // contraseña (queda bloqueado, como uno fuera de la whitelist).
  const settings = await readAppSettings();
  if (!settings.passwordUnlockEnabled) {
    await recordAttempt({
      pendingId: null,
      pcName,
      usernameTried,
      serialNumber,
      result: "DISABLED",
    });
    return NextResponse.json(
      {
        authorized: false,
        message: "El desbloqueo por contraseña está desactivado.",
      },
      { status: 403 }
    );
  }

  const now = getCurrentDate();
  const baseWhere = {
    pcName,
    status: "BLOCKED" as const,
    expiresAt: { gte: now },
  };
  const pending =
    (await db.pendingUnlock.findFirst({
      where: {
        ...baseWhere,
        ...(driveLetter ? { driveLetter } : {}),
        ...(serialNumber ? { serialNumber } : {}),
      },
      orderBy: { createdAt: "desc" },
    })) ??
    (driveLetter || serialNumber
      ? await db.pendingUnlock.findFirst({
          where: baseWhere,
          orderBy: { createdAt: "desc" },
        })
      : null);

  if (!pending) {
    await recordAttempt({
      pcName,
      usernameTried,
      serialNumber,
      result: "NO_PENDING",
    });
    return NextResponse.json(GENERIC_DENIED, { status: 401 });
  }

  const auditBase = {
    pendingId: pending.id,
    pcName,
    usernameTried,
    serialNumber: pending.serialNumber ?? serialNumber,
  };

  // Fuera de la whitelist no hay contraseña que valga (ni la del admin):
  // el dispositivo queda bloqueado, sin más. El compañero ni siquiera
  // muestra el formulario en este caso; esto es la defensa en el servidor.
  if (!pending.whitelisted) {
    await recordAttempt({ ...auditBase, result: "NOT_WHITELISTED" });
    return NextResponse.json(
      {
        authorized: false,
        message: "USB no listado en la lista blanca: será bloqueado.",
      },
      { status: 403 }
    );
  }

  const user = usernameTried ? await findUser(usernameTried) : null;
  if (!user) {
    await simulatePasswordCheckDelay();
    await recordAttempt({ ...auditBase, result: "BAD_PASSWORD" });
    return NextResponse.json(GENERIC_DENIED, { status: 401 });
  }

  if (user.lockedUntil && user.lockedUntil > now) {
    await recordAttempt({ ...auditBase, userId: user.id, result: "LOCKED" });
    return NextResponse.json(GENERIC_DENIED, { status: 401 });
  }

  const { valid, needsRehash } = await verifyPassword(
    String(password),
    user.passwordHash
  );
  if (!valid) {
    await registerFailedAttempt(user, now);
    await recordAttempt({
      ...auditBase,
      userId: user.id,
      result: "BAD_PASSWORD",
    });
    return NextResponse.json(GENERIC_DENIED, { status: 401 });
  }

  // Propiedad: dueño de esta PC o admin (según el modo del equipo).
  const computer = await db.computer.findUnique({
    where: { name: pcName },
    select: { unlockMode: true },
  });
  const isAdmin = user.role === "ADMIN";
  const isOwner =
    user.computer?.name?.trim().toLowerCase() === pcName.trim().toLowerCase();
  const allowed =
    computer?.unlockMode === "ADMIN_ONLY" ? isAdmin : isAdmin || isOwner;

  if (!allowed) {
    await recordAttempt({ ...auditBase, userId: user.id, result: "NOT_OWNER" });
    return NextResponse.json(GENERIC_DENIED, { status: 401 });
  }

  await registerSuccess(user, String(password), needsRehash);
  await db.pendingUnlock.update({
    where: { id: pending.id },
    data: {
      status: "UNLOCKED",
      unlockedById: user.id,
      unlockedAt: now,
    },
  });
  await recordAttempt({ ...auditBase, userId: user.id, result: "SUCCESS" });

  return NextResponse.json({
    authorized: true,
    message: "Dispositivo desbloqueado.",
    username: user.username,
    driveLetter: pending.driveLetter,
  });
}

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

    // Con pcName: verificación 2FA de desbloqueo de dispositivo.
    if (typeof body.pcName === "string" && body.pcName.trim()) {
      return handleDeviceUnlock(body, body.pcName.trim());
    }

    // Sin pcName: verificación de credenciales simple (comportamiento
    // original de esta ruta, sin cambios).
    const normalizedUsername = String(username).trim();
    if (!normalizedUsername) {
      return NextResponse.json(
        { authorized: false, message: "Usuario inválido." },
        { status: 400 }
      );
    }

    const user = await findUser(normalizedUsername);
    if (!user) {
      await simulatePasswordCheckDelay();
      return NextResponse.json(
        { authorized: false, message: "Credenciales incorrectas." },
        { status: 401 }
      );
    }

    const now = getCurrentDate();
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
      await registerFailedAttempt(user, now);
      return NextResponse.json(
        { authorized: false, message: "Credenciales incorrectas." },
        { status: 401 }
      );
    }

    await registerSuccess(user, password, needsRehash);
    return NextResponse.json({
      authorized: true,
      message: "Credenciales verificadas correctamente.",
      username: user.username,
    });
  } catch (error) {
    console.error("Error en /api/usb-auth:", error);
    return NextResponse.json(
      { authorized: false, message: "Error interno del servidor." },
      { status: 500 }
    );
  }
}
