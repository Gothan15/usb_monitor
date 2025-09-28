import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";

// Endpoint ligero para comprobar estado de sesión sin devolver JSON grande.
// HEAD -> 200 autenticado, 401 no autenticado.
export async function HEAD(req: Request) {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return new NextResponse(null, { status: 401 });
  }
  return new NextResponse(null, { status: 200 });
}

// GET opcional por si algún cliente no soporta HEAD fácilmente.
export async function GET(req: Request) {
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
