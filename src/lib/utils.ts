import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

const CONTROL_CHARS_REGEX = /[\u0000-\u001F\u007F]/g;

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getCsrfTokenFromDocument(): string {
  if (typeof document === "undefined") return "";
  const cookie = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((entry) => entry.startsWith("csrf-token="));
  if (!cookie) return "";
  const [, value = ""] = cookie.split("=");
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function normalizeComputerName(input: string): string {
  const cleaned = (input ?? "").replace(CONTROL_CHARS_REGEX, "").trim();
  if (!cleaned) {
    return "";
  }
  return cleaned.toUpperCase().slice(0, 120);
}
