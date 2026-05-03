import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface LiveSyncState {
  isLiveSyncEnabled: boolean;
  toggleLiveSync: () => void;
}

export const useLiveSyncStore = create<LiveSyncState>()(
  persist(
    (set) => ({
      isLiveSyncEnabled: true,
      toggleLiveSync: () => set((state) => ({ isLiveSyncEnabled: !state.isLiveSyncEnabled })),
    }),
    {
      name: 'live-sync-storage',
    }
  )
);
