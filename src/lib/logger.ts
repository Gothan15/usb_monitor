import type { NextRequest } from "next/server";

function extractErrorMessage(error: unknown): string {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "object" && "message" in error) {
    const maybe = (error as Record<string, unknown>).message;
    if (typeof maybe === "string" && maybe.trim()) return maybe;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Unserializable error";
  }
}

function safeContext(context?: Record<string, unknown>) {
  if (!context) return undefined;
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string") {
      sanitized[key] = value.length > 256 ? `${value.slice(0, 253)}...` : value;
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      sanitized[key] = value;
      continue;
    }
    try {
      sanitized[key] = JSON.parse(JSON.stringify(value));
    } catch {
      sanitized[key] = String(value);
    }
  }
  return Object.keys(sanitized).length ? sanitized : undefined;
}

export function logError(
  message: string,
  error?: unknown,
  context?: Record<string, unknown>
) {
  const payload: Record<string, unknown> = {
    level: "error",
    message,
    error: error ? extractErrorMessage(error) : undefined,
    context: safeContext(context),
  };
  if (!payload.context) delete payload.context;
  if (!payload.error) delete payload.error;
  console.error(payload);
}

export function logWarn(message: string, context?: Record<string, unknown>) {
  const payload: Record<string, unknown> = {
    level: "warn",
    message,
    context: safeContext(context),
  };
  if (!payload.context) delete payload.context;
  console.warn(payload);
}

export function logInfo(message: string, context?: Record<string, unknown>) {
  const payload: Record<string, unknown> = {
    level: "info",
    message,
    context: safeContext(context),
  };
  if (!payload.context) delete payload.context;
  console.info(payload);
}

export function describeRequest(req: Request | NextRequest) {
  const ip = req.headers.get("x-forwarded-for") || "unknown";
  return { method: req.method, url: req.url, ip: ip.split(",")[0].trim() };
}
