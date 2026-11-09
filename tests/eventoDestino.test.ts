import { beforeEach, describe, expect, it } from "vitest";
import {
  destinoDesdeEventoSocket,
  filtrarEventosPorDestino,
  type EventoDestino,
  type EventoRegistroMinimo,
} from "@/lib/eventoDestino";
import { useEventosFiltroStore } from "@/store/useEventosFiltroStore";

const eventoSocket = {
  id: "evt-1",
  pcName: "PC-CAJA",
  pcIp: "192.168.1.20",
  pcUser: "caja",
  event: "BLOCKED",
  driveLetter: "E:",
  serialNumber: "AA123456",
  readonlyStatus: "READONLY",
  whitelisted: false,
  timestamp: "2026-11-08T20:00:00.000Z",
  createdAt: "2026-11-08T20:00:01.000Z",
};

const fila = (
  overrides: Partial<EventoRegistroMinimo> = {},
): EventoRegistroMinimo => ({
  id: "evt-1",
  pcName: "PC-CAJA",
  event: "BLOCKED",
  serialNumber: "AA123456",
  ...overrides,
});

describe("destinoDesdeEventoSocket", () => {
  it("mapea el evento de socket al destino del aviso", () => {
    expect(destinoDesdeEventoSocket(eventoSocket)).toEqual<EventoDestino>({
      eventoId: "evt-1",
      pcName: "PC-CAJA",
      tipo: "BLOCKED",
      serialNumber: "AA123456",
      createdAt: "2026-11-08T20:00:01.000Z",
    });
  });

  it("deja el serial a null cuando el evento no lo trae", () => {
    const sinSerial = { ...eventoSocket, serialNumber: undefined };
    expect(destinoDesdeEventoSocket(sinSerial).serialNumber).toBeNull();
  });
});

describe("filtrarEventosPorDestino", () => {
  const destino = destinoDesdeEventoSocket(eventoSocket);

  it("encuentra por id exacto y devuelve solo ese evento", () => {
    const eventos = [
      fila({ id: "evt-9" }), // mismo equipo/tipo/serial, otro id
      fila(), // el del id buscado
      fila({ id: "evt-7", pcName: "OTRO-PC" }),
    ];
    const resultado = filtrarEventosPorDestino(eventos, destino);
    expect(resultado.exacto).toBe(true);
    expect(resultado.coincidencias.map((e) => e.id)).toEqual(["evt-1"]);
  });

  it("cae a equipo + tipo + serial cuando el id ya no está cargado", () => {
    const eventos = [
      fila({ id: "evt-9" }),
      fila({ id: "evt-8", serialNumber: "ZZ999" }),
      fila({ id: "evt-7", event: "UNLOCKED" }),
      fila({ id: "evt-6", pcName: "OTRO-PC" }),
    ];
    const resultado = filtrarEventosPorDestino(eventos, destino);
    expect(resultado.exacto).toBe(false);
    expect(resultado.coincidencias.map((e) => e.id)).toEqual(["evt-9"]);
  });

  it("la reserva no distingue mayúsculas en equipo ni en serial", () => {
    const eventos = [fila({ id: "evt-9", pcName: "pc-caja", serialNumber: "aa123456" })];
    const resultado = filtrarEventosPorDestino(eventos, destino);
    expect(resultado.coincidencias.map((e) => e.id)).toEqual(["evt-9"]);
  });

  it("sin serial en el destino, la reserva se apoya en equipo y tipo", () => {
    const destinoSinSerial: EventoDestino = { ...destino, serialNumber: null };
    const eventos = [
      fila({ id: "evt-9", serialNumber: "CUALQUIERA" }),
      fila({ id: "evt-8", event: "CONNECTED" }),
    ];
    const resultado = filtrarEventosPorDestino(eventos, destinoSinSerial);
    expect(resultado.exacto).toBe(false);
    expect(resultado.coincidencias.map((e) => e.id)).toEqual(["evt-9"]);
  });

  it("sin coincidencias devuelve la lista vacía", () => {
    const resultado = filtrarEventosPorDestino(
      [fila({ id: "evt-9", pcName: "OTRO-PC" })],
      destino,
    );
    expect(resultado).toEqual({ coincidencias: [], exacto: false });
  });
});

describe("useEventosFiltroStore", () => {
  beforeEach(() => {
    useEventosFiltroStore.getState().limpiarDestino();
  });

  it("guarda el destino solicitado y lo limpia a petición", () => {
    const destino = destinoDesdeEventoSocket(eventoSocket);
    useEventosFiltroStore.getState().solicitarDestino(destino);
    expect(useEventosFiltroStore.getState().destinoPendiente).toEqual(destino);
    useEventosFiltroStore.getState().limpiarDestino();
    expect(useEventosFiltroStore.getState().destinoPendiente).toBeNull();
  });
});
