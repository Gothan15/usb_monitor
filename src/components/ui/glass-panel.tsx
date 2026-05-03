import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const glassPanelVariants = cva("rounded-xl transition-all duration-200", {
  variants: {
    variant: {
      default: "glass",
      subtle: "glass-subtle",
      elevated: "glass-elevated",
      solid: "bg-card border border-border shadow-sm",
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
