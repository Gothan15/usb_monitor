"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { TourDefinition, TourStep } from "@/lib/tours";

/* ── localStorage persistence ── */

const STORAGE_PREFIX = "usb-monitor:tour-completed:";

function isTourCompleted(tourId: string): boolean {
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${tourId}`) === "true";
  } catch {
    return false;
  }
}

function markTourCompleted(tourId: string): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${tourId}`, "true");
  } catch {
    // ignore
  }
}

export function resetTour(tourId: string): void {
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${tourId}`);
  } catch {
    // ignore
  }
}

/* ── Rect helpers ── */

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function getElementRect(selector: string): Rect | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/* ── Component ── */

interface TourEngineProps {
  tour: TourDefinition;
  /** If true, force-start even if previously completed */
  forceStart?: boolean;
  /** Called when tour finishes or is skipped */
  onComplete?: () => void;
}

export function TourEngine({
  tour,
  forceStart = false,
  onComplete,
}: TourEngineProps) {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const step: TourStep | undefined = tour.steps[stepIndex];
  const totalSteps = tour.steps.length;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === totalSteps - 1;

  // Auto-start if not completed
  useEffect(() => {
    if (forceStart || !isTourCompleted(tour.id)) {
      // Small delay so the page has rendered tour target elements
      const timer = setTimeout(() => setActive(true), 800);
      return () => clearTimeout(timer);
    }
  }, [tour.id, forceStart]);

  // Track target element position
  useLayoutEffect(() => {
    if (!active || !step?.target) {
      setTargetRect(null);
      return;
    }

    const update = () => {
      const rect = getElementRect(step.target!);
      setTargetRect(rect);
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [active, step?.target, stepIndex]);

  const finish = useCallback(() => {
    setActive(false);
    markTourCompleted(tour.id);
    onComplete?.();
  }, [tour.id, onComplete]);

  const next = useCallback(() => {
    if (isLast) {
      finish();
    } else {
      setStepIndex((i) => i + 1);
    }
  }, [isLast, finish]);

  const prev = useCallback(() => {
    if (!isFirst) setStepIndex((i) => i - 1);
  }, [isFirst]);

  // Escape key to skip
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, finish, next, prev]);

  // Popover position calculation
  const popoverStyle = useMemo(() => {
    if (!targetRect || !step?.target) {
      // Center on screen
      return {
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      } as const;
    }

    const padding = 16;
    const pos = step.position ?? "bottom";
    const cx = targetRect.left + targetRect.width / 2;

    switch (pos) {
      case "bottom":
        return {
          top: `${targetRect.top + targetRect.height + padding}px`,
          left: `${Math.max(padding, Math.min(cx - 180, window.innerWidth - 376))}px`,
        } as const;
      case "top":
        return {
          bottom: `${window.innerHeight - targetRect.top + padding}px`,
          left: `${Math.max(padding, Math.min(cx - 180, window.innerWidth - 376))}px`,
        } as const;
      case "right":
        return {
          top: `${Math.max(padding, targetRect.top)}px`,
          left: `${targetRect.left + targetRect.width + padding}px`,
        } as const;
      case "left":
        return {
          top: `${Math.max(padding, targetRect.top)}px`,
          right: `${window.innerWidth - targetRect.left + padding}px`,
        } as const;
    }
  }, [targetRect, step?.target, step?.position]);

  if (!active || !step) return null;

  const StepIcon = step.icon;
  const spotlightPadding = 8;

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key="tour-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[9999]"
        >
          {/* Backdrop with spotlight cutout */}
          <svg
            className="absolute inset-0 size-full"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <mask id="tour-spotlight-mask">
                <rect width="100%" height="100%" fill="white" />
                {targetRect && (
                  <rect
                    x={targetRect.left - spotlightPadding}
                    y={targetRect.top - spotlightPadding}
                    width={targetRect.width + spotlightPadding * 2}
                    height={targetRect.height + spotlightPadding * 2}
                    rx="12"
                    fill="black"
                  />
                )}
              </mask>
            </defs>
            <rect
              width="100%"
              height="100%"
              fill="rgba(0,0,0,0.6)"
              mask="url(#tour-spotlight-mask)"
              className="backdrop-blur-[2px]"
            />
          </svg>

          {/* Spotlight ring glow */}
          {targetRect && (
            <div
              className="absolute rounded-xl ring-2 ring-primary/60 ring-offset-2 ring-offset-transparent transition-all duration-300"
              style={{
                top: targetRect.top - spotlightPadding,
                left: targetRect.left - spotlightPadding,
                width: targetRect.width + spotlightPadding * 2,
                height: targetRect.height + spotlightPadding * 2,
              }}
            />
          )}

          {/* Popover card */}
          <motion.div
            ref={popoverRef}
            key={stepIndex}
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="absolute z-10 w-[360px]"
            style={popoverStyle}
          >
            <GlassPanel variant="elevated" className="p-5 shadow-2xl">
              {/* Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  {StepIcon && (
                    <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <StepIcon className="size-4" />
                    </div>
                  )}
                  <h3 className="text-sm font-semibold text-foreground">
                    {step.title}
                  </h3>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={finish}
                >
                  <X className="size-3.5" />
                </Button>
              </div>

              {/* Body */}
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                {step.description}
              </p>

              {/* Footer */}
              <div className="mt-4 flex items-center justify-between">
                <span className="text-[10px] font-medium text-muted-foreground/60">
                  {stepIndex + 1} de {totalSteps}
                </span>
                <div className="flex items-center gap-1.5">
                  {!isFirst && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={prev}
                    >
                      <ChevronLeft className="size-3" />
                      Atrás
                    </Button>
                  )}
                  {isFirst && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-muted-foreground"
                      onClick={finish}
                    >
                      Saltar
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="h-7 gap-1 px-3 text-xs"
                    onClick={next}
                  >
                    {isLast ? "Comenzar" : "Siguiente"}
                    {!isLast && <ChevronRight className="size-3" />}
                  </Button>
                </div>
              </div>

              {/* Step progress dots */}
              <div className="mt-3 flex justify-center gap-1">
                {tour.steps.map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      "h-1 rounded-full transition-all duration-300",
                      i === stepIndex
                        ? "w-4 bg-primary"
                        : i < stepIndex
                          ? "w-1.5 bg-primary/40"
                          : "w-1.5 bg-muted-foreground/20",
                    )}
                  />
                ))}
              </div>
            </GlassPanel>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
