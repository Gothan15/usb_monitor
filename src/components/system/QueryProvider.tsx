"use client";

import { useState, type ReactNode } from "react";
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientConfig,
} from "@tanstack/react-query";

const defaultQueryClientConfig: QueryClientConfig = {
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 1,
    },
  },
};

export function QueryProvider({
  children,
  config,
}: {
  children: ReactNode;
  config?: QueryClientConfig;
}) {
  const [client] = useState(
    () => new QueryClient(config ?? defaultQueryClientConfig)
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
