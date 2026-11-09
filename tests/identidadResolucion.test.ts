import { beforeEach, describe, expect, it, vi } from "vitest";

// Resolución de identidad contra una base de datos falsa en
// memoria: lo que aquí se fija es el comportamiento que la
// primera vuelta (PR #132) no cubrió y Gothan vio fallar en
// su Windows con la v1.0.23 — la fila «por IP» de la
// instalación remota no se renombraba ni se reclamaba, porque
// el emparejamiento solo miraba el nombre y la IP de origen
// de la conexión. La falsa implementa la superficie mínima de
// Prisma que usa identidadEquipo (findUnique/findFirst/
// update/delete/updateMany y $transaction pasante).

const falso = vi.hoisted(() => {
  interface Fila {
    [clave: string]: unknown;
  }
  const tablas: Record<string, Fila[]> = {
    computer: [],
    user: [],
    pendingUnlock: [],
    agentCommand: [],
    installTaskTarget: [],
    uSBEvent: [],
    unlockAttempt: [],
  };

  function coincide(fila: Fila, where: Record<string, unknown>): boolean {
    for (const [clave, valor] of Object.entries(where ?? {})) {
      if (clave === "NOT") {
        if (coincide(fila, valor as Record<string, unknown>)) return false;
        continue;
      }
      if (fila[clave] !== valor) return false;
    }
    return true;
  }

  function proyectar(fila: Fila, select?: Record<string, boolean>): Fila {
    if (!select) return { ...fila };
    const salida: Fila = {};
    for (const clave of Object.keys(select)) {
      if (select[clave]) salida[clave] = fila[clave] ?? null;
    }
    return salida;
  }

  function apiDe(nombre: string) {
    const filas = tablas[nombre];
    return {
      findUnique: async ({ where, select }: any) => {
        const fila = filas.find((f) => coincide(f, where));
        return fila ? proyectar(fila, select) : null;
      },
      findFirst: async ({ where, select, orderBy }: any) => {
        const candidatas = filas.filter((f) => coincide(f, where));
        if (orderBy?.createdAt === "asc") {
          candidatas.sort(
            (a, b) =>
              new Date(a.createdAt as string).getTime() -
              new Date(b.createdAt as string).getTime(),
          );
        }
        return candidatas.length ? proyectar(candidatas[0], select) : null;
      },
      findMany: async ({ where }: any) =>
        filas.filter((f) => coincide(f, where ?? {})),
      update: async ({ where, data }: any) => {
        const fila = filas.find((f) => coincide(f, where));
        if (fila) Object.assign(fila, data);
        return fila;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const fila of filas) {
          if (coincide(fila, where)) {
            Object.assign(fila, data);
            count++;
          }
        }
        return { count };
      },
      delete: async ({ where }: any) => {
        const indice = filas.findIndex((f) => coincide(f, where));
        if (indice >= 0) filas.splice(indice, 1);
        return null;
      },
    };
  }

  const computer = apiDe("computer");
  const db = {
    computer,
    $transaction: async (cb: (tx: any) => Promise<void>) => {
      const tx: Record<string, unknown> = { computer };
      for (const nombre of Object.keys(tablas)) {
        if (nombre !== "computer") tx[nombre] = apiDe(nombre);
      }
      await cb(tx);
    },
  };

  return { tablas, db };
});

vi.mock("@/lib/db", () => ({ db: falso.db }));
vi.mock("@/lib/logger", () => ({
  logInfo: () => {},
  logWarn: () => {},
  logError: () => {},
}));

import {
  fusionarDuplicadoDeReporte,
  resolverEquipoParaAgente,
} from "@/lib/identidadEquipo";

const EN_UNA_HORA = new Date(Date.now() + 3_600_000);

function filaEquipo(parcial: Record<string, unknown>) {
  return {
    id: "eq",
    name: "PC",
    ipAddress: "",
    clavePublica: null,
    credencialAt: null,
    codigoEnrolamientoHash: null,
    codigoEnrolamientoExpira: null,
    lastSeen: null,
    createdAt: new Date("2026-11-08T08:00:00Z"),
    serviceInstalled: false,
    serviceRunning: false,
    agentVersion: null,
    ...parcial,
  };
}

/** La fila que deja una instalación remota: bautizada con la IP. */
function filaMarcador() {
  return filaEquipo({
    id: "fila-ip",
    name: "172.26.125.38",
    ipAddress: "172.26.125.38",
    codigoEnrolamientoHash: "hash-del-codigo",
    codigoEnrolamientoExpira: EN_UNA_HORA,
    serviceInstalled: true,
  });
}

function equipos() {
  return falso.tablas.computer;
}

beforeEach(() => {
  for (const filas of Object.values(falso.tablas)) filas.length = 0;
});

describe("resolverEquipoParaAgente — la fila de la instalación remota", () => {
  it("se reclama por el código aunque ni el origen ni las declaradas sean la IP del empuje, y se renombra al nombre real", async () => {
    equipos().push(filaMarcador());
    // La conexión llega desde la IP del adaptador NAT y esa es
    // también la única declarada: sin la vía del código, esto
    // era el 401 «otro-equipo» eterno de Gothan.
    const resuelto = await resolverEquipoParaAgente({
      nombre: "pc-vm",
      ip: "10.0.2.15",
      ips: ["10.0.2.15"],
      filaDelCodigoId: "fila-ip",
    });
    expect(resuelto).toEqual({ id: "fila-ip", name: "PC-VM" });
    expect(equipos()).toHaveLength(1);
    expect(equipos()[0].name).toBe("PC-VM");
    // El código sigue en la fila resultante: es la que el
    // enrolamiento va a validar y la que la tarea está mirando.
    expect(equipos()[0].codigoEnrolamientoHash).toBe("hash-del-codigo");
  });

  it("empareja cuando la IP del empuje es la SEGUNDA que el agente declara", async () => {
    equipos().push(filaMarcador());
    const resuelto = await resolverEquipoParaAgente({
      nombre: "pc-vm",
      ip: "10.0.2.15",
      ips: ["10.0.2.15", "172.26.125.38"],
    });
    expect(resuelto).toEqual({ id: "fila-ip", name: "PC-VM" });
    expect(equipos()[0].name).toBe("PC-VM");
  });

  it("la fusión de la fila-nombre y la fila-IP conserva el nombre real y reapunta las relaciones a la fila del código", async () => {
    equipos().push(
      filaEquipo({ id: "fila-nombre", name: "PC-VM", ipAddress: "10.0.2.15" }),
      filaMarcador(),
    );
    falso.tablas.user.push({ id: "u1", computerId: "fila-nombre" });
    falso.tablas.uSBEvent.push({ id: "e1", pcName: "PC-VM" });

    const resuelto = await resolverEquipoParaAgente({
      nombre: "PC-VM",
      ip: "10.0.2.15",
      ips: ["10.0.2.15", "172.26.125.38"],
      filaDelCodigoId: "fila-ip",
    });

    // Una sola fila, con el NOMBRE REAL (no pisado por la IP) y
    // siendo la del código: la que la tarea está mirando.
    expect(equipos()).toHaveLength(1);
    expect(resuelto).toEqual({ id: "fila-ip", name: "PC-VM" });
    expect(equipos()[0].codigoEnrolamientoHash).toBe("hash-del-codigo");
    expect(falso.tablas.user[0].computerId).toBe("fila-ip");
  });

  it("un código atado a una fila con nombre REAL no se reclama como marcador", async () => {
    equipos().push(
      filaEquipo({
        id: "fila-oficina",
        name: "PC-OFICINA",
        ipAddress: "10.0.0.9",
        codigoEnrolamientoHash: "hash-del-codigo",
        codigoEnrolamientoExpira: EN_UNA_HORA,
      }),
    );
    const resuelto = await resolverEquipoParaAgente({
      nombre: "PC-VM",
      ip: "10.0.2.15",
      ips: ["10.0.2.15"],
      filaDelCodigoId: "fila-oficina",
    });
    // Ni empareja ni renombra: el choque sigue siendo del
    // diagnóstico («código de otro equipo»), como en el alta
    // manual de siempre.
    expect(resuelto).toBeNull();
    expect(equipos()[0].name).toBe("PC-OFICINA");
  });

  it("el alta manual no cambia: la fila del nombre manda y no se renombra", async () => {
    equipos().push(
      filaEquipo({
        id: "fila-nombre",
        name: "PC-VM",
        ipAddress: "10.0.2.15",
        codigoEnrolamientoHash: "hash-del-codigo",
        codigoEnrolamientoExpira: EN_UNA_HORA,
      }),
    );
    const resuelto = await resolverEquipoParaAgente({
      nombre: "pc-vm",
      ip: "10.0.2.15",
      ips: ["10.0.2.15", "192.168.1.50"],
      filaDelCodigoId: "fila-nombre",
    });
    expect(resuelto).toEqual({ id: "fila-nombre", name: "PC-VM" });
    expect(equipos()).toHaveLength(1);
  });
});

describe("fusionarDuplicadoDeReporte — autocura del nombre al reportar", () => {
  it("la fila acreditada bautizada con una IP adopta el nombre real que reporta el agente", async () => {
    equipos().push(
      filaEquipo({
        id: "acreditada",
        name: "172.26.125.38",
        ipAddress: "172.26.125.38",
        clavePublica: "SPKI...",
        credencialAt: new Date(),
      }),
    );
    await fusionarDuplicadoDeReporte("acreditada", "pc-vm");
    expect(equipos()).toHaveLength(1);
    expect(equipos()[0].name).toBe("PC-VM");
  });

  it("una fila con nombre real NO se renombra porque el agente reporte otro", async () => {
    equipos().push(
      filaEquipo({
        id: "acreditada",
        name: "PC-VIEJA",
        clavePublica: "SPKI...",
        credencialAt: new Date(),
      }),
    );
    await fusionarDuplicadoDeReporte("acreditada", "PC-NUEVA");
    // Sin otra fila de por medio y sin marcador-IP, el nombre
    // guardado manda: renombrar PCs a la brava rompería la
    // identidad que el administrador ve en Equipos.
    expect(equipos()[0].name).toBe("PC-VIEJA");
  });
});
