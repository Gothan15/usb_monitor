// Sin IPs de redes concretas en el código: el origen público real se
// define con ALLOWED_ORIGINS o APP_PUBLIC_HOST en el entorno.
const APP_PUBLIC_HOST = (process.env.APP_PUBLIC_HOST || "").trim();
const DEFAULT_ALLOWED_ORIGINS = [
  "https://usbmonitor.local",
  "http://localhost:3000",
  "https://localhost:3000",
  ...(APP_PUBLIC_HOST ? [`https://${APP_PUBLIC_HOST}:3000`] : []),
];

export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) {
    return DEFAULT_ALLOWED_ORIGINS;
  }

  const entries = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    return DEFAULT_ALLOWED_ORIGINS;
  }

  return Array.from(new Set(entries));
}

interface BuildContentSecurityPolicyOptions {
  allowedOrigins: string[];
  development: boolean;
  nonce?: string;
}

export function buildContentSecurityPolicy({
  allowedOrigins,
  development,
  nonce,
}: BuildContentSecurityPolicyOptions): string {
  const scriptSrc = new Set(["'self'"]);
  if (nonce) {
    scriptSrc.add(`'nonce-${nonce}'`);
    scriptSrc.add("'strict-dynamic'");
  }
  if (development) {
    scriptSrc.add("'unsafe-eval'");
    // Permitir scripts inline durante el desarrollo facilita el hot reload de Next.js
    scriptSrc.add("'unsafe-inline'");
  }

  const styleSrc = new Set(["'self'", "'unsafe-inline'", "https:"]);

  const connectSrc = new Set(["'self'", "https:", "wss:"]);
  if (development) {
    connectSrc.add("http:");
    connectSrc.add("ws:");
  }
  for (const origin of allowedOrigins) {
    connectSrc.add(origin);
  }

  const directives = [
    "default-src 'self'",
    `script-src ${Array.from(scriptSrc).join(" ")}`,
    `style-src ${Array.from(styleSrc).join(" ")}`,
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${Array.from(connectSrc).join(" ")}`,
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ];

  if (!development) {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}

export const SECURITY_ALLOWED_ORIGINS = DEFAULT_ALLOWED_ORIGINS;
