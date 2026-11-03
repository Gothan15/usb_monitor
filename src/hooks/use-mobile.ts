import * as React from "react"

const MOBILE_BREAKPOINT = 768

function suscribirse(onChange: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

export function useIsMobile() {
  // La media query es un sistema externo: useSyncExternalStore la
  // lee sin efecto ni estado intermedio (en servidor, no móvil).
  return React.useSyncExternalStore(
    suscribirse,
    () => window.innerWidth < MOBILE_BREAKPOINT,
    () => false
  )
}
