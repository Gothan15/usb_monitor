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

function safelyParse(payload: string) {
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}
