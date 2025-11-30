import type { InjectionToken } from "tsyringe";

export type TokenMap = typeof TOKENS;

/**
 * Central registry of injection tokens used across the project.
 * Symbols are preferred to reduce collision risk when using global containers.
 */
export const TOKENS = {
  prisma: Symbol.for("PrismaClient"),
  logger: Symbol.for("Logger"),
  serviceNotifier: Symbol.for("ServiceNotifier"),
} satisfies Record<string, InjectionToken<unknown>>;

type ValueOf<T> = T[keyof T];
export type AnyToken = ValueOf<TokenMap>;
