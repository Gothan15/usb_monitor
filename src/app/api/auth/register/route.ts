import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, generateApiKey } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();
    if (!username || !password)
      return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
    const exists = await (db as any).user.findUnique({ where: { username } });
    if (exists)
      return NextResponse.json({ error: "Usuario ya existe" }, { status: 409 });
    const passwordHash = hashPassword(password);
    const apiKey = generateApiKey();
    const user = await (db as any).user.create({
      data: { username, passwordHash, apiKey },
    });
    return NextResponse.json({ id: user.id, username, apiKey });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
