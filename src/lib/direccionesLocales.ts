import os from "node:os";

/**
 * Las direcciones del PROPIO equipo: las IPv4 de sus interfaces
 * reales (ni la interna de loopback ni las de enlace local
 * 169.254.x.x, que no sirven para llegar a ningún sitio).
 *
 * El panel escucha en todas las interfaces (0.0.0.0), así que
 * estas son exactamente las direcciones en las que el servidor
 * está levantado. Se calculan una vez y se guardan: la lista
 * que importa es la del arranque, que es cuando cambia la IP
 * si el DHCP la renueva.
 */

let cache: string[] | null = null;

export function direccionesIpv4Locales(): string[] {
  if (cache) return cache;
  const encontradas = new Set<string>();
  try {
    for (const entradas of Object.values(os.networkInterfaces())) {
      for (const detalle of entradas ?? []) {
        if (!detalle || detalle.internal) continue;
        if (detalle.family !== "IPv4") continue;
        if (!detalle.address || detalle.address.startsWith("169.254.")) {
          continue;
        }
        encontradas.add(detalle.address);
      }
    }
  } catch {
    // Sin red o sin permiso para enumerarla: lista vacía y el
    // resto de orígenes (localhost, APP_PUBLIC_HOST…) sigue.
  }
  cache = [...encontradas];
  return cache;
}

/** Los orígenes (http y https) de este equipo para un puerto. */
export function origenesLocales(puerto: number): string[] {
  return direccionesIpv4Locales().flatMap((ip) => [
    `http://${ip}:${puerto}`,
    `https://${ip}:${puerto}`,
  ]);
}
