import { NextRequest, NextResponse } from "next/server";
import { requireAuth, generateApiKey } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const apiKey = generateApiKey();
    await (db as any).user.update({ where: { id: userId }, data: { apiKey } });
    return NextResponse.json({ apiKey });
  } catch (e: any) {
    if (e.message === "UNAUTHORIZED")
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
