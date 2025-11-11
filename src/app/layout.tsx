import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import AuthGate from "@/components/system/AuthGate";
import { ThemeProvider } from "@/components/system/ThemeProvider";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
  icons: [{ rel: "icon", url: "/favicon.svg" }],
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider>
          {/* AuthGate protege rutas usando cookie de sesión; /login se gestiona dentro del propio AuthGate */}
          <AuthGate>{children}</AuthGate>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
