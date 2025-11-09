import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/auth";
import { normalizeSerial, serializeWhitelistEntry } from "../_helpers";

export async function GET(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json(
      { ok: false, error: "No autorizado" },
      { status: 401 }
    );
  }

  const serialParam = req.nextUrl.searchParams.get("serial") ?? "";
  const normalizedSerial = normalizeSerial(serialParam);

  if (!normalizedSerial) {
    return NextResponse.json(
      { ok: false, error: "serial es requerido" },
      { status: 400 }
    );
  }

  try {
    const entry = await (db as any).uSBWhitelist.findUnique({
      where: { serialNumber: normalizedSerial },
      include: { createdBy: { select: { id: true, username: true } } },
    });

    return NextResponse.json({
      ok: true,
      allowed: Boolean(entry),
      entry: entry ? serializeWhitelistEntry(entry) : null,
    });
  } catch (error) {
    console.error("Error verificando whitelist:", error);
    return NextResponse.json(
      { ok: false, error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
