"use client";

import { type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";

interface PageTransitionProps {
  /** Used as React key to trigger animation on route change */
  transitionKey: string;
  children: ReactNode;
  className?: string;
}

const variants = {
  initial: { opacity: 0, y: 18, filter: "blur(6px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -10, filter: "blur(6px)" },
};

/**
 * Wraps page content with a smooth fade+slide+blur transition.
 * Use `transitionKey` (usually the pathname) to trigger on navigation.
 */
export function PageTransition({
  transitionKey,
  children,
  className,
}: PageTransitionProps) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={transitionKey}
        variants={variants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
