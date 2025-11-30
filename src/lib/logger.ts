import type { NextRequest } from "next/server";

type LogLevel = "info" | "warn" | "error";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

const LEVEL_COLORS: Record<LogLevel, string> = {
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};

const ICONS: Record<LogLevel, { unicode: string; ascii: string }> = {
  info: { unicode: "▲", ascii: "^" },
  warn: { unicode: "⚠", ascii: "!" },
  error: { unicode: "✖", ascii: "x" },
};

const supportsColor = (() => {
  if (typeof process === "undefined") return false;
  if (!process.stdout || !process.stdout.isTTY) return false;
  return process.env.FORCE_COLOR !== "0";
})();

const supportsUnicode = (() => {
  if (typeof process === "undefined") return false;
  if (!supportsColor) return false;
  if (process.platform !== "win32") return true;
  return Boolean(
    process.env.WT_SESSION ||
      process.env.TERM_PROGRAM === "vscode" ||
      process.env.TERM_PROGRAM === "WindowsTerminal"
  );
})();

function style(
  text: string,
  options?: { color?: string; bold?: boolean; dim?: boolean }
) {
  if (!supportsColor) return text;
  const codes: string[] = [];
  if (options?.color) codes.push(options.color);
  if (options?.bold) codes.push(BOLD);
  if (options?.dim) codes.push(DIM);
  if (!codes.length) return text;
  return `${codes.join("")}${text}${RESET}`;
}

function chooseIcon(level: LogLevel) {
  const iconSet = ICONS[level];
  return supportsUnicode ? iconSet.unicode : iconSet.ascii;
}

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

function formatValueLines(value: unknown): string[] {
  if (value === null) return ["null"];
  if (value === undefined) return [];
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    if (!value.length) return ["[]"];
    const simple = value.every(
      (item) =>
        item === null || ["string", "number", "boolean"].includes(typeof item)
    );
    if (simple) {
      return [
        value
          .map((item) =>
            item === null
              ? "null"
              : typeof item === "string"
              ? item
              : String(item)
          )
          .join(", "),
      ];
    }
  }
  try {
    return JSON.stringify(value, null, 2).split("\n");
  } catch {
    return [String(value)];
  }
}

function formatContextLines(
  context: Record<string, unknown>,
  level: LogLevel
): string[] {
  const entries = Object.entries(context);
  if (!entries.length) return [];
  return entries.flatMap(([key, value]) => {
    const serialized = formatValueLines(value);
    const label = style(key, { color: LEVEL_COLORS[level], bold: true });
    if (!serialized.length) {
      return [`   - ${label}: ${style("—", { dim: true })}`];
    }
    if (serialized.length === 1) {
      return [`   - ${label}: ${style(serialized[0], { dim: true })}`];
    }
    return [
      `   - ${label}:`,
      ...serialized.map((line) => `       ${style(line, { dim: true })}`),
    ];
  });
}

function emitLog(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
  error?: string
) {
  const icon = style(chooseIcon(level), {
    color: LEVEL_COLORS[level],
    bold: true,
  });
  const title = style(message, {
    color: LEVEL_COLORS[level],
    bold: true,
  });
  const lines = [`${icon} ${title}`];

  if (error) {
    lines.push(
      `   - ${style("error", {
        color: LEVEL_COLORS.error,
        dim: true,
      })}: ${style(error, {
        dim: true,
      })}`
    );
  }

  const sanitizedContext = safeContext(context);
  if (sanitizedContext) {
    lines.push(...formatContextLines(sanitizedContext, level));
  }

  const output = lines.join("\n");
  if (level === "error") {
    console.error(output);
    return;
  }
  if (level === "warn") {
    console.warn(output);
    return;
  }
  console.info(output);
}

export function logError(
  message: string,
  error?: unknown,
  context?: Record<string, unknown>
) {
  emitLog(
    "error",
    message,
    context,
    error ? extractErrorMessage(error) : undefined
  );
}

export function logWarn(message: string, context?: Record<string, unknown>) {
  emitLog("warn", message, context);
}

export function logInfo(message: string, context?: Record<string, unknown>) {
  emitLog("info", message, context);
}

export function describeRequest(req: Request | NextRequest) {
  const ip = req.headers.get("x-forwarded-for") || "unknown";
  return { method: req.method, url: req.url, ip: ip.split(",")[0].trim() };
}
