import { defineConfig } from "vitest/config";
import path from "path";

// Tests del panel: lógica pura y contratos (sin base de datos).
// Lo que depende de Postgres se sigue verificando con las pruebas
// de integración manuales; aquí vive lo que puede fallar en silencio
// con un refactor: rangos CIDR del escáner, el formato de los hashes
// de contraseña, los saneadores de la ingesta y los nombres de equipo.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      DATABASE_URL: "postgresql://user:pass@localhost:5432/monitor_usb",
      SESSION_SECRET: "secreto-de-pruebas-suficientemente-largo-123456",
    },
  },
});
