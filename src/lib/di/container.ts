import "reflect-metadata";

import type { PrismaClient } from "@prisma/client";
import { container, type InjectionToken } from "tsyringe";

import { db } from "@/lib/db";
import { describeRequest, logError, logInfo, logWarn } from "@/lib/logger";
import { checkServiceHealth } from "@/lib/serviceNotifier";

import { TOKENS } from "./tokens";

export interface LoggerService {
  logError: typeof logError;
  logWarn: typeof logWarn;
  logInfo: typeof logInfo;
  describeRequest: typeof describeRequest;
}

export interface ServiceNotifierService {
  checkHealth: typeof checkServiceHealth;
}

let initialized = false;

function registerCoreSingletons(): void {
  if (initialized) return;

  container.register<PrismaClient>(TOKENS.prisma, {
    useValue: db,
  });

  container.register<LoggerService>(TOKENS.logger, {
    useValue: {
      logError,
      logWarn,
      logInfo,
      describeRequest,
    },
  });

  container.register<ServiceNotifierService>(TOKENS.serviceNotifier, {
    useValue: {
      checkHealth: checkServiceHealth,
    },
  });

  initialized = true;
}

function ensureInitialized(): void {
  if (!initialized) registerCoreSingletons();
}

export function resolve<T>(token: InjectionToken<T>): T {
  ensureInitialized();
  return container.resolve(token);
}

export function withContainer<T>(fn: (di: typeof container) => T): T {
  ensureInitialized();
  return fn(container);
}

export function resetContainer(): void {
  container.reset();
  initialized = false;
}

export { TOKENS };
