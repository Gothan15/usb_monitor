"use client";

import { type ReactNode } from "react";
import { motion } from "framer-motion";

interface PageTransitionProps {
  /** Used as React key to trigger animation on route change */
  transitionKey: string;
  children: ReactNode;
  className?: string;
}

/**
 * Wraps page content with a short enter animation on route change.
 *
 * Solo hay animación de entrada: la versión anterior usaba
 * AnimatePresence en modo «wait» con salida y entrada de 0,38 s
 * cada una, así que cada cambio de pestaña pagaba ~0,76 s de
 * animación en serie antes de ver el contenido nuevo. Sin salida,
 * el contenido nuevo aparece al momento y se asienta en 0,2 s.
 */
export function PageTransition({
  transitionKey,
  children,
  className,
}: PageTransitionProps) {
  return (
    <motion.div
      key={transitionKey}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
