import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "rounded-md bg-muted/60",
        "bg-[length:200%_100%] bg-[linear-gradient(90deg,transparent_25%,rgba(255,255,255,0.08)_50%,transparent_75%)]",
        "animate-[shimmer_1.5s_ease-in-out_infinite]",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
