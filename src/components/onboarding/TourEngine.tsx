"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
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
  const router = useRouter();
  const pathname = usePathname();
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

  // Reactivación desde Ajustes: quien quiera repetir la guía
  // limpia su marca de «vista» y dispara este evento con el id
  // de la guía; el motor que la tenga montada la reinicia.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ tourId?: string }>).detail;
      if (detail?.tourId && detail.tourId !== tour.id) return;
      setStepIndex(0);
      setActive(true);
    };
    window.addEventListener("usb-monitor:restart-tour", handler);
    return () => window.removeEventListener("usb-monitor:restart-tour", handler);
  }, [tour.id]);

  // Llegada al paso: si el objetivo vive en otra vista, la guía
  // NAVEGA hasta ella, espera a que monte, desplaza la vista
  // hasta el componente (scrollIntoView suave, centrado) y
  // entonces mide para el foco. Mientras tanto no hay foco:
  // el telón cubre todo y la tarjeta se lee en el centro.
  useEffect(() => {
    if (!active || !step) return;
    let cancelled = false;
    let poll: number | undefined;
    let settle: number | undefined;

    const arrive = () => {
      if (!step.target) {
        setTargetRect(null);
        return;
      }
      const el = document.querySelector(step.target);
      if (!el) {
        setTargetRect(null);
        return;
      }
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      // Medir al momento y otra vez cuando el desplazamiento
      // se asienta, para que el foco caiga en su sitio final.
      setTargetRect(getElementRect(step.target));
      settle = window.setTimeout(() => {
        if (!cancelled) setTargetRect(getElementRect(step.target!));
      }, 550);
    };

    const comenzar = () => {
      if (step.view && pathname !== step.view) {
        setTargetRect(null);
        router.push(step.view);
        const started = Date.now();
        poll = window.setInterval(() => {
          if (cancelled) return;
          if (!step.target || document.querySelector(step.target)) {
            window.clearInterval(poll);
            arrive();
          } else if (Date.now() - started > 3000) {
            window.clearInterval(poll);
            setTargetRect(null);
          }
        }, 120);
      } else {
        arrive();
      }
    };

    // La llegada trabaja sobre el DOM ya pintado: se programa en
    // el siguiente frame y sus setState quedan asíncronos.
    const frame = window.requestAnimationFrame(() => {
      if (!cancelled) comenzar();
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      if (poll) window.clearInterval(poll);
      if (settle) window.clearTimeout(settle);
    };
    // pathname se lee pero no es dependencia: al llegar a la
    // vista destino el efecto no debe relanzar la llegada.
  }, [active, stepIndex, step?.target, step?.view, tour.id, router]);

  // Track target element position
  useLayoutEffect(() => {
    // Sin objetivo no hay nada que seguir; el rect anterior se
    // ignora al pintar (la tarjeta se centra y el telón solo se
    // muestra con la guía activa), así que no hace falta limpiarlo.
    if (!active || !step?.target) return;

    const update = () => {
      const rect = getElementRect(step.target!);
      setTargetRect(rect);
    };

    // La primera medición va en el siguiente frame (asíncrona);
    // las demás llegan por los eventos de resize y scroll.
    const frame = window.requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.cancelAnimationFrame(frame);
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

  // Tamaño real de la tarjeta, para poder centrarla y
  // voltearla cuando no cabe junto a su objetivo.
  const [cardSize, setCardSize] = useState({ width: 360, height: 250 });
  useLayoutEffect(() => {
    if (!active) return;
    const el = popoverRef.current;
    if (!el) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    if (width > 0 && height > 0) {
      setCardSize((prev) =>
        prev.width === width && prev.height === height
          ? prev
          : { width, height },
      );
    }
  });

  // Posición de la tarjeta en píxeles. La tarjeta NO se remonta
  // en cada paso: su posición se anima con un muelle y el cartel
  // VIAJA por la pantalla hasta el siguiente objetivo (y al
  // centro mientras la guía cambia de vista).
  const popoverPos = useMemo(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 16;
    const clampLeft = (v: number) =>
      Math.max(margin, Math.min(v, vw - cardSize.width - margin));
    const clampTop = (v: number) =>
      Math.max(margin, Math.min(v, vh - cardSize.height - margin));

    if (!targetRect || !step?.target) {
      return {
        top: Math.max(margin, (vh - cardSize.height) / 2),
        left: Math.max(margin, (vw - cardSize.width) / 2),
      };
    }

    const pos = step.position ?? "bottom";
    const cx = targetRect.left + targetRect.width / 2;
    switch (pos) {
      case "right":
        return {
          top: clampTop(targetRect.top),
          left: Math.min(
            targetRect.left + targetRect.width + margin,
            vw - cardSize.width - margin,
          ),
        };
      case "left":
        return {
          top: clampTop(targetRect.top),
          left: Math.max(margin, targetRect.left - cardSize.width - margin),
        };
      case "top": {
        const above = targetRect.top - cardSize.height - margin;
        return {
          top:
            above >= margin
              ? above
              : clampTop(targetRect.top + targetRect.height + margin),
          left: clampLeft(cx - cardSize.width / 2),
        };
      }
      case "bottom":
      default: {
        const below = targetRect.top + targetRect.height + margin;
        return {
          top:
            below + cardSize.height <= vh - margin
              ? below
              : clampTop(targetRect.top - cardSize.height - margin),
          left: clampLeft(cx - cardSize.width / 2),
        };
      }
    }
  }, [targetRect, step?.target, step?.position, cardSize]);

  // Geometría del hueco del telón: un div transparente cuya
  // sombra exterior oscurece todo lo demás. Sus medidas se
  // animan por CSS, así que el hueco también se desliza de un
  // componente a otro en vez de saltar.
  const spotlightStyle = useMemo(() => {
    if (!targetRect) return null;
    return {
      top: targetRect.top - 8,
      left: targetRect.left - 8,
      width: targetRect.width + 16,
      height: targetRect.height + 16,
    };
  }, [targetRect]);

  if (!active || !step) return null;

  const StepIcon = step.icon;

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key="tour-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-0 z-[9999]"
        >
          {/* Telón: con objetivo, un div transparente cuya sombra
              exterior oscurece todo menos el hueco enfocado; sin
              objetivo, un telón liso. Ambos se cruzan con un
              fundido y el hueco viaja animando su geometría. */}
          <div
            className="absolute inset-0 bg-black/60 transition-opacity duration-500"
            style={{ opacity: targetRect ? 0 : 1 }}
          />
          <div
            className="absolute rounded-xl transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{
              ...(spotlightStyle ?? { top: 0, left: 0, width: 0, height: 0 }),
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
              opacity: targetRect ? 1 : 0,
            }}
          />

          {/* Anillo del foco, solidario con el hueco */}
          <div
            className="pointer-events-none absolute rounded-xl ring-2 ring-primary/60 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{
              ...(spotlightStyle ?? { top: 0, left: 0, width: 0, height: 0 }),
              opacity: targetRect ? 1 : 0,
            }}
          />

          {/* Tarjeta viajera: vive montada durante todo el
              recorrido y se desplaza con un muelle hasta cada
              objetivo; solo su contenido se renueva, con un
              fundido corto a mitad de camino. */}
          <motion.div
            ref={popoverRef}
            initial={{ opacity: 0, top: popoverPos.top, left: popoverPos.left }}
            animate={{ opacity: 1, top: popoverPos.top, left: popoverPos.left }}
            transition={{
              opacity: { duration: 0.25 },
              top: { type: "spring", stiffness: 200, damping: 30, mass: 0.9 },
              left: { type: "spring", stiffness: 200, damping: 30, mass: 0.9 },
            }}
            className="absolute z-10 w-[360px]"
          >
            <motion.div
              key={stepIndex}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
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
        </motion.div>
      )}
    </AnimatePresence>
  );
}
