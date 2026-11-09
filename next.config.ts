import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // La brújula se pide con quality={100} en la cabecera y en el
    // login. Next 16 solo acepta las calidades declaradas aquí y,
    // sin esta lista (por defecto solo [75]), el optimizador
    // respondía 400 «"q" parameter (quality) of 100 is not allowed»
    // y la imagen no se servía en absoluto. Con la calidad admitida,
    // la brújula de 1254×1254 (~2 MB) se sirve reducida a lo que se
    // muestra (22–176 px): unos pocos KB.
    qualities: [75, 100],
  },
  // El zip de la Release del agente pesa ~95 MB y se sube desde
  // Ajustes (POST /api/admin/agent-package): el proxy de Next
  // almacena el cuerpo de cada petición con un tope de 10 MB y lo
  // recortaba en silencio, dejando la subida inservible. Se sube
  // el tope a 200 MB. SOLO la clave actual: Next 16.4.5 rechaza
  // el arranque si conviven las dos (la antigua y la nueva).
  experimental: {
    proxyClientMaxBodySize: "200mb",
  },
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
