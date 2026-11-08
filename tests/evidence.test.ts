import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_IMAGEN_EVIDENCIA_BYTES,
  validarPaqueteEvidencia,
} from "@/lib/evidence";

// ── La ruta POST, con la BD y la credencial simuladas ─────────
// El patrón de la casa es probar la lógica sin Postgres; aquí se
// simulan solo los bordes (auth, db, rate limit) para fijar el
// contrato de la ruta: 401 sin firma del equipo, 400 con el
// paquete mal formado, 404 si el bloqueo no existe y 200 guardando.
const mocks = vi.hoisted(() => ({
  requireAgentAuth: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  hit: vi.fn(),
}));

vi.mock("@/lib/agentAuth", () => ({
  requireAgentAuth: mocks.requireAgentAuth,
}));
vi.mock("@/lib/db", () => ({
  db: {
    pendingUnlock: { findUnique: mocks.findUnique },
    blockEvidence: { create: mocks.create },
  },
}));
vi.mock("@/lib/rateLimit", () => ({ hit: mocks.hit }));
vi.mock("@/lib/socket", () => ({ broadcastUnlockChange: vi.fn() }));
vi.mock("@/lib/agentDebug", () => ({ registrarContactoAgente: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

const JPEG_MINIMO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function paqueteValido() {
  return {
    pendingUnlockId: "bloqueo-1",
    serialNumber: "AA0101",
    capturedAt: "2026-11-05T12:00:00.000Z",
    foregroundProcess: "WINWORD",
    foregroundTitle: "informe.docx - Word",
    processes: [{ proceso: "WINWORD", titulo: "informe.docx - Word" }],
    browserTabs: [{ navegador: "chrome", titulo: "Panel" }],
    tabsComplete: false,
    nota: null,
    imagenBase64: JPEG_MINIMO.toString("base64"),
  };
}

function peticion(cuerpo: unknown) {
  return new Request("http://panel/api/usb-event/evidence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
}

describe("validarPaqueteEvidencia", () => {
  it("acepta el paquete del agente y decodifica la imagen", () => {
    const resultado = validarPaqueteEvidencia(paqueteValido());
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.datos.pendingUnlockId).toBe("bloqueo-1");
    expect(resultado.datos.imageMime).toBe("image/jpeg");
    expect(resultado.datos.image?.length).toBe(JPEG_MINIMO.length);
    expect(resultado.datos.capturedAt.toISOString()).toBe(
      "2026-11-05T12:00:00.000Z",
    );
    expect(resultado.datos.tabsComplete).toBe(false);
  });

  it("sin imagen también es válido (sesión bloqueada al conectar)", () => {
    const cuerpo = { ...paqueteValido(), imagenBase64: undefined, nota: "sin escritorio" };
    const resultado = validarPaqueteEvidencia(cuerpo);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.datos.image).toBeNull();
    expect(resultado.datos.nota).toBe("sin escritorio");
  });

  it("exige el id del bloqueo y una fecha válida", () => {
    expect(validarPaqueteEvidencia({ ...paqueteValido(), pendingUnlockId: "" }).ok).toBe(false);
    expect(validarPaqueteEvidencia({ ...paqueteValido(), capturedAt: "ayer" }).ok).toBe(false);
    expect(validarPaqueteEvidencia(null).ok).toBe(false);
  });

  it("rechaza una imagen que no es JPEG ni PNG y una que pasa de 4 MB", () => {
    const texto = Buffer.from("esto no es una imagen").toString("base64");
    expect(
      validarPaqueteEvidencia({ ...paqueteValido(), imagenBase64: texto }).ok,
    ).toBe(false);
    const enorme = Buffer.alloc(MAX_IMAGEN_EVIDENCIA_BYTES + 1, 0xff);
    enorme[0] = 0xff; enorme[1] = 0xd8; enorme[2] = 0xff;
    expect(
      validarPaqueteEvidencia({
        ...paqueteValido(),
        imagenBase64: enorme.toString("base64"),
      }).ok,
    ).toBe(false);
  });

  it("acota las listas de procesos y pestañas", () => {
    const muchos = Array.from({ length: 500 }, (_, i) => ({
      proceso: `p${i}`,
    }));
    const resultado = validarPaqueteEvidencia({
      ...paqueteValido(),
      processes: muchos,
    });
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.datos.processes).toHaveLength(200);
  });
});

describe("POST /api/usb-event/evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hit.mockResolvedValue({ allowed: true, remaining: 5, resetIn: 0 });
    mocks.requireAgentAuth.mockResolvedValue({
      type: "service",
      serviceId: "agente-1",
      token: "t",
      computerId: "pc-1",
    });
    mocks.findUnique.mockResolvedValue({ pcName: "PC-PRUEBAS" });
    mocks.create.mockResolvedValue({ id: "evidencia-1" });
  });

  async function cargarRuta() {
    return import("@/app/api/usb-event/evidence/route");
  }

  it("sin credencial de servicio responde 401 y no guarda nada", async () => {
    mocks.requireAgentAuth.mockRejectedValue(new Error("UNAUTHORIZED"));
    const { POST } = await cargarRuta();
    const res = await POST(peticion(paqueteValido()));
    expect(res.status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("con el paquete mal formado responde 400", async () => {
    const { POST } = await cargarRuta();
    const res = await POST(peticion({ serialNumber: "X" }));
    expect(res.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("si el bloqueo no existe responde 404", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const { POST } = await cargarRuta();
    const res = await POST(peticion(paqueteValido()));
    expect(res.status).toBe(404);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("guarda la evidencia con el nombre de equipo del bloqueo", async () => {
    const { POST } = await cargarRuta();
    const res = await POST(peticion(paqueteValido()));
    expect(res.status).toBe(200);
    const cuerpo = await res.json();
    expect(cuerpo.ok).toBe(true);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const datos = mocks.create.mock.calls[0][0].data;
    expect(datos.computerName).toBe("PC-PRUEBAS");
    expect(datos.pendingUnlockId).toBe("bloqueo-1");
    expect(datos.imageMime).toBe("image/jpeg");
  });
});
