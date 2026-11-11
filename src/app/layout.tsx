import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import AuthGate from "@/components/system/AuthGate";
import { ThemeProvider } from "@/components/system/ThemeProvider";
import { QueryProvider } from "@/components/system/QueryProvider";

// El middleware pone una CSP con nonce NUEVO EN CADA PETICIÓN y
// Next solo puede sellar ese nonce en los scripts de la página si
// la página se renderiza en esa petición. Sin esto, en producción
// (npm run start) las páginas salen prerenderizadas del build, sus
// scripts inline no llevan el nonce de la respuesta, el navegador
// los bloquea TODOS por CSP y la página se ve en blanco. En
// desarrollo no se notaba: la CSP de desarrollo permite
// 'unsafe-inline'. No quitar sin cambiar antes la CSP.
export const dynamic = "force-dynamic";

// Fuentes AUTOALOJADAS (next/font/local): hasta el 2026-11-10
// las tres salían de next/font/google, que descarga las
// fuentes de fonts.googleapis.com AL COMPILAR — y desde la
// red de Gothan ese dominio no responde, así que su build
// moría con «Failed to fetch … from Google Fonts» aunque el
// código estuviera perfecto. Los woff2 variables viven en
// src/app/fonts (sacados de los paquetes Fontsource 5.3.0,
// licencia OFL incluida en esa carpeta; el subconjunto latin
// cubre todo el español: ñ y acentos son Latin-1) y el build
// ya no necesita internet para las fuentes.
const inter = localFont({
  src: "./fonts/inter-latin-wght-normal.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
});
const playfair = localFont({
  src: "./fonts/playfair-display-latin-wght-normal.woff2",
  variable: "--font-playfair",
  weight: "400 900",
  display: "swap",
});
const jetbrainsMono = localFont({
  src: [
    { path: "./fonts/jetbrains-mono-latin-wght-normal.woff2", style: "normal" },
    { path: "./fonts/jetbrains-mono-latin-wght-italic.woff2", style: "italic" },
  ],
  variable: "--font-jetbrains",
  weight: "100 800",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Monitor USB - Seguridad y Control",
  description:
    "Panel moderno para monitoreo y control de eventos USB en red. Seguridad reforzada, autenticación avanzada y CLI para administración.",
  keywords: [
    "USB",
    "Seguridad",
    "Monitoreo",
    "Next.js",
    "TypeScript",
    "Tailwind CSS",
    "shadcn/ui",
    "Argon2id",
    "Rate limiting",
    "Prisma",
    "CLI",
  ],
  authors: [{ name: "Monitor USB Team" }],
  icons: [
    { rel: "icon", url: "/favicon.ico", sizes: "any" },
    {
      rel: "icon",
      url: "/brujula-claro.png",
      type: "image/png",
      media: "(prefers-color-scheme: light)",
    },
    {
      rel: "icon",
      url: "/brujula-oscura.png",
      type: "image/png",
      media: "(prefers-color-scheme: dark)",
    },
  ],
  openGraph: {
    title: "Monitor USB - Seguridad y Control",
    description:
      "Panel moderno para monitoreo y control de eventos USB en red.",
    url: "https://usbmonitor.local",
    siteName: "Monitor USB",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Monitor USB - Seguridad y Control",
    description:
      "Panel moderno para monitoreo y control de eventos USB en red.",
  },
};

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F3EF" },
    { media: "(prefers-color-scheme: dark)", color: "#14120F" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      {/* <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <meta name="theme-color" content="#2563eb" />
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws:; object-src 'none'; frame-ancestors 'none'; base-uri 'self';"
        />
        <meta httpEquiv="X-Content-Type-Options" content="nosniff" />
        <meta httpEquiv="X-Frame-Options" content="DENY" />
        <meta httpEquiv="Referrer-Policy" content="no-referrer" />
        <meta httpEquiv="Permissions-Policy" content="usb=()" />
      </head> */}
      <body
        className={`${inter.variable} ${playfair.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <ThemeProvider>
          <QueryProvider>
            {/* AuthGate protege rutas usando cookie de sesión; /login se gestiona dentro del propio AuthGate */}
            <AuthGate>{children}</AuthGate>
            <Toaster />
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
