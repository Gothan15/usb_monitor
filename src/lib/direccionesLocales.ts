import dgram from "node:dgram";
import os from "node:os";

/**
 * Las direcciones del PROPIO equipo y, sobre todo, LA suya: la
 * de la ruta por defecto, que es la que le asigna el DHCP a su
 * adaptador de red. El acceso al panel es por esa única
 * dirección (server.ts); la lista completa de interfaces queda
 * para el CSP y como reserva si no hubiera ruta.
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

/** Los dos orígenes (http y https) de UNA dirección y un puerto. */
export function origenesDeDireccion(
  direccion: string,
  puerto: number,
): string[] {
  return [`http://${direccion}:${puerto}`, `https://${direccion}:${puerto}`];
}

/** Los orígenes (http y https) de este equipo para un puerto. */
export function origenesLocales(puerto: number): string[] {
  return direccionesIpv4Locales().flatMap((ip) =>
    origenesDeDireccion(ip, puerto),
  );
}

let cachePrincipal: string | undefined | null = null;

/**
 * LA dirección del equipo: la que el sistema operativo elige
 * para salir por la ruta por defecto — en la práctica, la de
 * su adaptador de red, la que le asigna el DHCP. Se pregunta
 * con un enchufe UDP «conectado» a una dirección de fuera: no
 * se envía ni un byte, pero el sistema tiene que elegir por
 * qué adaptador saldría, y esa dirección local es la que
 * devuelve. Sin ruta (equipo sin red) devuelve undefined.
 */
export async function direccionPrincipal(): Promise<string | undefined> {
  if (cachePrincipal !== null) return cachePrincipal;
  cachePrincipal = await new Promise<string | undefined>((resolver) => {
    const enchufe = dgram.createSocket("udp4");
    const temporizador = setTimeout(() => {
      try {
        enchufe.close();
      } catch {
        // Ya cerrado: da igual.
      }
      resolver(undefined);
    }, 1500);
    enchufe.on("error", () => {
      clearTimeout(temporizador);
      resolver(undefined);
    });
    enchufe.connect(80, "8.8.8.8", () => {
      clearTimeout(temporizador);
      try {
        const direccion = enchufe.address().address;
        resolver(
          direccion && direccion !== "0.0.0.0" ? direccion : undefined,
        );
      } catch {
        resolver(undefined);
      } finally {
        try {
          enchufe.close();
        } catch {
          // Ya cerrado: da igual.
        }
      }
    });
  });
  return cachePrincipal;
}
