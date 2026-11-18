import { getCsrfTokenFromDocument } from "@/lib/utils";

export class HttpError extends Error {
  status: number;
  body?: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

interface FetchJsonOptions extends RequestInit {
  expectedStatus?: number | number[];
}

function normalizeExpectedStatus(expected?: number | number[]) {
  if (typeof expected === "number") {
    return [expected];
  }
  if (Array.isArray(expected)) {
    return expected;
  }
  return undefined;
}

export async function fetchJson<T>(
  input: RequestInfo,
  init: FetchJsonOptions = {}
): Promise<T> {
  const { expectedStatus, headers, credentials, cache, ...rest } = init;
  const response = await fetch(input, {
    credentials: credentials ?? "include",
    cache: cache ?? "no-store",
    headers,
    ...rest,
  });

  const okStatuses = normalizeExpectedStatus(expectedStatus);
  const isExpected = okStatuses?.includes(response.status);

  const text = await response.text().catch(() => "");
  const body = text ? safelyParse(text) : undefined;

  if (!response.ok && !isExpected) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as Record<string, unknown>).error)
        : `HTTP ${response.status}`;
    throw new HttpError(response.status, message, body ?? text);
  }

  return (body as T) ?? ({} as T);
}

/**
 * Lectura JSON de la API: el alias con nombre de lo que hacen
 * los servicios de `src/lib/api/` para no repetir `fetchJson`
 * con la URL a pelo en cada componente.
 */
export function lecturaJson<T>(url: string): Promise<T> {
  return fetchJson<T>(url);
}

/**
 * Mutación JSON contra la API con todo lo que cada componente
 * montaba a mano hasta ahora: el token CSRF leído del documento
 * (sin token no se ni se intenta: se lanza el mismo aviso que
 * enseñaban las pestañas), el cuerpo serializado y el error del
 * servidor convertido en `HttpError` con su mensaje. Los
 * servicios de `src/lib/api/` se apoyan en esta única puerta.
 */
export async function mutacionJson<T>(
  url: string,
  metodo: "POST" | "PATCH" | "PUT" | "DELETE",
  cuerpo?: unknown,
): Promise<T> {
  const csrf = getCsrfTokenFromDocument();
  if (!csrf) {
    throw new HttpError(
      401,
      "Sesión sin token de seguridad: inicia sesión nuevamente.",
    );
  }
  return fetchJson<T>(url, {
    method: metodo,
    headers: {
      "x-csrf-token": csrf,
      ...(cuerpo !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
  });
}

function safelyParse(payload: string) {
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}
