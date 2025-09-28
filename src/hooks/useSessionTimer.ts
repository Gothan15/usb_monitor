"use client";
// Hook de temporizador de sesión deshabilitado porque se ha eliminado la lógica de expiración.
// Se mantiene export para evitar romper imports existentes; siempre retorna null.
export function useSessionTimer() {
  return { remaining: null as number | null };
}
