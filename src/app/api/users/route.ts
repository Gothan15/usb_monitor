import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { hashPassword, generateApiKey } from "@/lib/auth";
import { requireAdminUser } from "@/lib/admin";
import {
  buildUserSearchFilter,
  normalizeIpAddress,
  sanitizePassword,
  sanitizeUsername,
  serializeUser,
} from "./_helpers";

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "No autorizado" },
    { status: 401 },
  );
}

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

function notFound(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 404 });
}

export async function GET(req: NextRequest) {
  const admin = await requireAdminUser(req);
  if (!admin) return unauthorized();

  const { searchParams } = new URL(req.url);
  const pageParam = Number(searchParams.get("page") || "1");
  const pageSizeParam = Number(searchParams.get("pageSize") || "10");
  const searchRaw = searchParams.get("q");

  const search = searchRaw?.trim() || null;
  const page =
    Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
  const pageSizeRaw =
    Number.isFinite(pageSizeParam) && pageSizeParam > 0
      ? Math.floor(pageSizeParam)
      : 10;
  const pageSize = Math.min(Math.max(pageSizeRaw, 1), 100);

  try {
    const where = buildUserSearchFilter(search);
    const total = await db.user.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(Math.max(page, 1), totalPages);
    const skip = (safePage - 1) * pageSize;

    const users = await db.user.findMany({
      where,
      include: {
        computer: {
          select: { id: true, name: true, ipAddress: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    });

    return NextResponse.json({
      ok: true,
      items: users.map(serializeUser),
      total,
      page: safePage,
      pageSize,
    });
  } catch (error) {
    console.error("Error listing users:", error);
    return NextResponse.json(
      { ok: false, error: "Error interno del servidor" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const admin = await requireAdminUser(req);
  if (!admin) return unauthorized();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("JSON inválido");
  }

  const username = sanitizeUsername(body?.username);
  const password = sanitizePassword(body?.password);
  const ipAddress = normalizeIpAddress(body?.ipAddress);

  if (!username) {
    return badRequest("El nombre de usuario es obligatorio");
  }

  if (!password) {
    return badRequest("La contraseña es obligatoria");
  }

  let computerId: string | null = null;
  if (ipAddress) {
    const computer = await db.computer.findFirst({
      where: {
        ipAddress: {
          equals: ipAddress,
          mode: "insensitive",
        },
      },
      select: { id: true },
    });

    if (!computer) {
      return notFound("No se encontró una computadora con esa IP");
    }

    computerId = computer.id;
  }

  try {
    const passwordHash = await hashPassword(password);
    const apiKey = generateApiKey();

    const user = await db.user.create({
      data: {
        username,
        passwordHash,
        apiKey,
        role: "USER",
        computerId,
      },
      include: {
        computer: {
          select: { id: true, name: true, ipAddress: true },
        },
      },
    });

    return NextResponse.json({
      ok: true,
      item: serializeUser(user),
    });
  } catch (error: any) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { ok: false, error: "El usuario ya existe" },
        { status: 409 },
      );
    }

    console.error("Error creating user:", error);
    return NextResponse.json(
      { ok: false, error: "Error interno del servidor" },
      { status: 500 },
    );
  }
}
