const DEFAULT_LOCALE =
  process.env.NEXT_PUBLIC_APP_LOCALE ||
  process.env.NEXT_PUBLIC_LOCALE ||
  "es-ES";

const fallbackTimeZone = (() => {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return resolved || "UTC";
  } catch {
    return "UTC";
  }
})();

export const DEFAULT_TIME_ZONE =
  process.env.NEXT_PUBLIC_TIME_ZONE ||
  process.env.APP_TIME_ZONE ||
  fallbackTimeZone;

type SupportedValue = string | number | Date | null | undefined;

const createFormatter = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    hour12: false,
    timeZone: DEFAULT_TIME_ZONE,
    ...options,
  });

const dateTimeFormatter = createFormatter({
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const dateFormatter = createFormatter({
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const timeFormatter = createFormatter({
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const timeFormatterNoSeconds = createFormatter({
  hour: "2-digit",
  minute: "2-digit",
});

const hourFormatter = createFormatter({
  hour: "2-digit",
});

const normalizeDate = (value: SupportedValue) => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }
  if (typeof value === "string" && value.trim()) {
    const fromString = new Date(value);
    return Number.isNaN(fromString.getTime()) ? null : fromString;
  }
  return null;
};

export function formatDateTime(value: SupportedValue): string {
  const date = normalizeDate(value);
  return date ? dateTimeFormatter.format(date) : "—";
}

export function formatDate(value: SupportedValue): string {
  const date = normalizeDate(value);
  return date ? dateFormatter.format(date) : "—";
}

export function formatTime(
  value: SupportedValue,
  { seconds = true }: { seconds?: boolean } = {}
): string {
  const date = normalizeDate(value);
  if (!date) return "—";
  return seconds
    ? timeFormatter.format(date)
    : timeFormatterNoSeconds.format(date);
}

export function formatHour(value: SupportedValue): string {
  const date = normalizeDate(value);
  return date ? hourFormatter.format(date) : "—";
}

export function getCurrentDate(): Date {
  return new Date();
}

export function getCurrentTimestamp(): number {
  return getCurrentDate().getTime();
}

export function getCurrentIsoString(): string {
  return getCurrentDate().toISOString();
}

export function addMillisecondsToNow(ms: number): Date {
  return new Date(getCurrentTimestamp() + ms);
}
