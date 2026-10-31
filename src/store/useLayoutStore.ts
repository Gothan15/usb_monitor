import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Disposición del panel: cabecera superior o barra lateral. */
export type Disposicion = "cabecera" | "lateral";

interface LayoutState {
  disposicion: Disposicion;
  setDisposicion: (d: Disposicion) => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      disposicion: "cabecera",
      setDisposicion: (disposicion) => set({ disposicion }),
    }),
    {
      name: "layout-storage",
    },
  ),
);
