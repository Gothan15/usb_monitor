// ¿La petición viene de la propia PC del servidor?
//
// La lista blanca solo se cambia desde la máquina donde
// corre el panel: dar de alta un serial es el acto de
// confianza máximo del sistema y no debe poder hacerse
// desde un navegador remoto, ni siquiera con sesión de
// administrador. La IP del cliente la anota server.ts
// desde el socket (x-client-ip, no falsificable) y aquí
// se contrasta con las direcciones de esta máquina.

import { networkInterfaces } from "node:os";

import { ipClienteDe } from "@/lib/auth";

// Normaliza para comparar: sin espacios, en minúsculas y
// sin el prefijo de IPv4 mapeado en IPv6 (::ffff:a.b.c.d).
function normalizar(ip: string): string {
  let v = (ip || "").trim().toLowerCase();
  if (v.startsWith("::ffff:")) v = v.slice("::ffff:".length);
  return v;
}

// Regla pura: la IP del cliente es «del servidor» si es
// loopback o coincide con alguna dirección de la máquina.
export function esIpDelServidor(
  ipCliente: string,
  direccionesLocales: string[],
): boolean {
  const ip = normalizar(ipCliente);
  if (!ip) return false;
  if (ip === "127.0.0.1" || ip === "::1") return true;
  return direccionesLocales.some((d) => normalizar(d) === ip);
}

// Todas las direcciones (IPv4 e IPv6) de esta máquina.
export function direccionesDeEstaMaquina(): string[] {
  const out: string[] = [];
  for (const lista of Object.values(networkInterfaces())) {
    for (const red of lista ?? []) out.push(red.address);
  }
  return out;
}

// Atajo para las rutas: ¿esta petición nace en el servidor?
export function peticionDesdeElServidor(req: Request): boolean {
  return esIpDelServidor(ipClienteDe(req), direccionesDeEstaMaquina());
}
