// Servicio de red: las interfaces del servidor y el escaneo
// de la red local de la pestaña Escáner.

import { lecturaJson, mutacionJson } from "@/lib/http";
import type { NetworkInterfaceInfo } from "@/lib/networkScanner";

/**
 * Las interfaces de red del servidor. Lista vacía si la
 * lectura falla: el selector simplemente no aparece.
 */
export async function interfaces(): Promise<NetworkInterfaceInfo[]> {
  try {
    const data = await lecturaJson<{ interfaces?: NetworkInterfaceInfo[] }>(
      "/api/network-interfaces",
    );
    return Array.isArray(data?.interfaces) ? data.interfaces : [];
  } catch {
    return [];
  }
}

/**
 * Lanza un escaneo y devuelve su resultado en bruto (la
 * pestaña lo normaliza: equipos vivos, ordenados por IP, con
 * su aviso de cobertura).
 */
export function escanear(payload: Record<string, unknown>) {
  return mutacionJson<{
    results?: unknown[];
    redes?: { cidr: string; coberturaParcial?: boolean }[];
    [clave: string]: unknown;
  }>("/api/network-scan", "POST", payload);
}
