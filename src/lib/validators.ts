import { z } from "zod";

const CONTROL_CHARS_REGEX = /[\u0000-\u001F\u007F]/g;
const IPV4_REGEX = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export function isValidIPv4(value: string) {
  if (!IPV4_REGEX.test(value)) return false;
  return value.split(".").every((part) => {
    const num = Number(part);
    return Number.isInteger(num) && num >= 0 && num <= 255;
  });
}

function sanitizeControlChars(value: string) {
  return value.replace(CONTROL_CHARS_REGEX, "");
}

function buildSanitizedStringSchema(maxLength: number) {
  return z
    .string()
    .trim()
    .min(1, "required")
    .max(maxLength, `max ${maxLength} characters`)
    .transform((val) => sanitizeControlChars(val))
    .refine((val) => val.length > 0, "invalid value");
}

function buildOptionalSanitizedStringSchema(maxLength: number) {
  return z
    .preprocess((value) => {
      if (value == null) return undefined;
      if (typeof value !== "string") return undefined;
      const sanitized = sanitizeControlChars(value.trim());
      return sanitized.length ? sanitized : undefined;
    }, buildSanitizedStringSchema(maxLength))
    .optional();
}

const driveLetterSchema = z
  .preprocess((value) => {
    if (value == null) return undefined;
    if (typeof value !== "string") return undefined;
    const sanitized = sanitizeControlChars(value.trim().toUpperCase());
    if (!sanitized) return undefined;
    return sanitized.endsWith(":") ? sanitized : `${sanitized}:`;
  }, z.string().regex(/^[A-Z]:$/, "invalid drive letter"))
  .optional();

export const usbEventPayloadSchema = z.object({
  pc_name: buildSanitizedStringSchema(120),
  pc_ip: z
    .string()
    .trim()
    .refine((val) => isValidIPv4(val), "invalid ipv4"),
  pc_user: buildSanitizedStringSchema(120),
  event: buildSanitizedStringSchema(512),
  drive_letter: driveLetterSchema,
  serial_number: buildOptionalSanitizedStringSchema(128),
  readonly_status: buildOptionalSanitizedStringSchema(256),
  whitelisted: z.boolean().optional(),
});

export type UsbEventPayload = z.infer<typeof usbEventPayloadSchema>;

export const sanitizers = {
  sanitizeControlChars,
};
