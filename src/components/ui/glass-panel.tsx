import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const glassPanelVariants = cva("rounded-lg border border-border transition-all duration-300", {
  variants: {
    variant: {
      default: "bg-card",
      subtle: "bg-surface-2",
      elevated: "bg-card shadow-[0_18px_36px_-20px_rgba(74,58,28,0.28)]",
      solid: "bg-card",
    },
    padding: {
      none: "",
      sm: "p-3",
      default: "p-4",
      lg: "p-6",
    },
  },
  defaultVariants: {
    variant: "default",
    padding: "default",
  },
});

function GlassPanel({
  className,
  variant,
  padding,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof glassPanelVariants>) {
  return (
    <div
      data-slot="glass-panel"
      className={cn(glassPanelVariants({ variant, padding }), className)}
      {...props}
    />
  );
}

export { GlassPanel, glassPanelVariants };
