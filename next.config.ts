import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El zip de la Release del agente pesa ~95 MB y se sube desde
  // Ajustes (POST /api/admin/agent-package): el proxy de Next
  // almacena el cuerpo de cada petición con un tope de 10 MB y lo
  // recortaba en silencio, dejando la subida inservible. Se sube
  // el tope a 200 MB. Van las dos claves (la actual y la antigua)
  // porque el runtime las ha nombrado de las dos maneras según la
  // versión; la que no reconozca solo produce un aviso al arrancar.
  experimental: {
    proxyClientMaxBodySize: "200mb",
    middlewareClientMaxBodySize: "200mb",
  } as Record<string, unknown>,
  serverExternalPackages: ["ssh2"],
  turbopack: {},
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  async headers() {
    const securityHeaders = [
      {
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains; preload",
      },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      {
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
      },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), usb=()",
      },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Resource-Policy", value: "same-site" },
      { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
    ];

    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
