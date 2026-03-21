"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, ChevronDown } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Optional fallback component */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  showStack: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, showStack: false };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, showStack: false });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const isDev = process.env.NODE_ENV === "development";

      return (
        <div className="flex min-h-[300px] items-center justify-center p-8">
          <GlassPanel variant="elevated" className="max-w-lg p-6 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <AlertTriangle className="size-6" />
            </div>
            <h3 className="mt-4 text-sm font-semibold text-foreground">
              Algo salió mal
            </h3>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {this.state.error?.message ||
                "Error inesperado en la aplicación."}
            </p>

            <div className="mt-4 flex justify-center gap-2">
              <Button size="sm" onClick={this.handleRetry} className="gap-1.5">
                <RefreshCw className="size-3.5" />
                Reintentar
              </Button>
            </div>

            {isDev && this.state.error?.stack && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() =>
                    this.setState((s) => ({ showStack: !s.showStack }))
                  }
                  className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronDown
                    className={`size-3 transition-transform ${
                      this.state.showStack ? "rotate-180" : ""
                    }`}
                  />
                  Traza del error
                </button>
                {this.state.showStack && (
                  <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-muted/40 p-3 text-left font-mono text-[10px] text-muted-foreground scrollbar-thin">
                    {this.state.error.stack}
                  </pre>
                )}
              </div>
            )}
          </GlassPanel>
        </div>
      );
    }

    return this.props.children;
  }
}
