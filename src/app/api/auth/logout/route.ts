import { NextResponse } from "next/server";

export async function POST() {
  const isProd = process.env.NODE_ENV === "production";
  const flags = ["Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (isProd) flags.push("Secure");
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", `session=; ${flags.join("; ")}`);
  return res;
}
