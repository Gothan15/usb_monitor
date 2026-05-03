"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  RotateCcw,
  X,
} from "lucide-react";
import {
  type WidgetInstance,
  type WidgetSize,
  sizeToColSpan,
  loadLayout,
  saveLayout,
  clearLayout,
} from "./types";

/* ── Sortable Widget Card ── */

interface SortableWidgetProps {
  instance: WidgetInstance;
  title: string;
  children: ReactNode;
  onToggleCollapse: (id: string) => void;
  onRemove: (id: string) => void;
  onResize: (id: string, size: WidgetSize) => void;
}

function SortableWidget({
  instance,
  title,
  children,
  onToggleCollapse,
  onRemove,
  onResize,
}: SortableWidgetProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: instance.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      layout
      className={cn(
        sizeToColSpan[instance.size],
        isDragging && "z-50 opacity-80",
      )}
    >
      <GlassPanel
        variant="elevated"
        padding="none"
        className={cn(
          "group/widget overflow-hidden transition-shadow",
          isDragging && "shadow-2xl ring-2 ring-primary/30",
        )}
      >
        {/* Widget header */}
        <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
          <button
            type="button"
            className="cursor-grab touch-none text-muted-foreground/40 transition-colors hover:text-muted-foreground active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-3.5" />
          </button>

          <span className="flex-1 truncate text-xs font-semibold text-foreground">
            {title}
          </span>

          {/* Size toggle */}
          <div className="hidden items-center gap-0.5 group-hover/widget:flex">
            {(["sm", "md", "lg", "full"] as WidgetSize[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onResize(instance.id, s)}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[9px] font-medium transition-colors",
                  instance.size === s
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground/50 hover:text-muted-foreground",
                )}
              >
                {s.toUpperCase()}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => onToggleCollapse(instance.id)}
            className="text-muted-foreground/40 transition-colors hover:text-muted-foreground"
          >
            {instance.collapsed ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronUp className="size-3.5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => onRemove(instance.id)}
            className="hidden text-muted-foreground/40 transition-colors hover:text-destructive group-hover/widget:block"
          >
            <X className="size-3.5" />
          </button>
        </div>

        {/* Widget content */}
        <AnimatePresence initial={false}>
          {!instance.collapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      </GlassPanel>
    </motion.div>
  );
}

/* ── Dashboard Grid ── */

interface WidgetRenderer {
  type: string;
  label: string;
  render: (instance: WidgetInstance) => ReactNode;
}

interface DashboardGridProps {
  /** Available widget renderers */
  widgets: WidgetRenderer[];
  /** Default layout if nothing saved */
  defaultLayout: WidgetInstance[];
  /** Extra className on grid */
  className?: string;
}

export function DashboardGrid({
  widgets,
  defaultLayout,
  className,
}: DashboardGridProps) {
  const [layout, setLayout] = useState<WidgetInstance[]>(() => {
    return loadLayout() ?? defaultLayout;
  });

  // Persist on change
  useEffect(() => {
    saveLayout(layout);
  }, [layout]);

  const widgetMap = useMemo(
    () => new Map(widgets.map((w) => [w.type, w])),
    [widgets],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setLayout((prev) => {
      const oldIndex = prev.findIndex((w) => w.id === active.id);
      const newIndex = prev.findIndex((w) => w.id === over.id);
      return arrayMove(prev, oldIndex, newIndex).map((w, i) => ({
        ...w,
        order: i,
      }));
    });
  }, []);

  const handleToggleCollapse = useCallback((id: string) => {
    setLayout((prev) =>
      prev.map((w) => (w.id === id ? { ...w, collapsed: !w.collapsed } : w)),
    );
  }, []);

  const handleRemove = useCallback((id: string) => {
    setLayout((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const handleResize = useCallback((id: string, size: WidgetSize) => {
    setLayout((prev) => prev.map((w) => (w.id === id ? { ...w, size } : w)));
  }, []);

  const handleReset = useCallback(() => {
    clearLayout();
    setLayout(defaultLayout);
  }, [defaultLayout]);

  const handleAddWidget = useCallback(
    (type: string) => {
      const def = widgetMap.get(type);
      if (!def) return;
      const newId = `${type}-${Date.now()}`;
      setLayout((prev) => [
        ...prev,
        {
          id: newId,
          type,
          size: "md",
          collapsed: false,
          order: prev.length,
        },
      ]);
    },
    [widgetMap],
  );

  // Available to add (types not yet in layout)
  const addableWidgets = useMemo(() => {
    const usedTypes = new Set(layout.map((w) => w.type));
    return widgets.filter((w) => !usedTypes.has(w.type));
  }, [layout, widgets]);

  const sortedLayout = useMemo(
    () => [...layout].sort((a, b) => a.order - b.order),
    [layout],
  );

  return (
    <div className={cn("space-y-4", className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {addableWidgets.length > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Añadir:
              </span>
              {addableWidgets.map((w) => (
                <Button
                  key={w.type}
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-[10px]"
                  onClick={() => handleAddWidget(w.type)}
                >
                  + {w.label}
                </Button>
              ))}
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-[10px] text-muted-foreground"
          onClick={handleReset}
        >
          <RotateCcw className="size-3" />
          Restablecer
        </Button>
      </div>

      {/* Sortable grid */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={sortedLayout.map((w) => w.id)}
          strategy={rectSortingStrategy}
        >
          <div className="grid gap-4 xl:grid-cols-3">
            {sortedLayout.map((instance) => {
              const def = widgetMap.get(instance.type);
              if (!def) return null;
              return (
                <SortableWidget
                  key={instance.id}
                  instance={instance}
                  title={def.label}
                  onToggleCollapse={handleToggleCollapse}
                  onRemove={handleRemove}
                  onResize={handleResize}
                >
                  {def.render(instance)}
                </SortableWidget>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
