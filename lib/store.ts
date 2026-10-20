import { useSyncExternalStore } from "react";
import type { Place } from "./places";

export interface AppState {
  /** 0–100 texture loading progress reported from inside the canvas. */
  progress: number;
  /** True once the first scene has compiled and drawn a frame. */
  ready: boolean;
  /** Set when the runtime FPS monitor decides the device is struggling. */
  degraded: boolean;
  /** Where "Your sky tonight" is computed for; drives the pin on the globe. */
  observer: Place | null;
}

const initial: AppState = { progress: 0, ready: false, degraded: false, observer: null };
let state = initial;
const listeners = new Set<() => void>();

export const appStore = {
  get: () => state,
  set(partial: Partial<AppState>) {
    state = { ...state, ...partial };
    listeners.forEach((l) => l());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useAppStore<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(
    appStore.subscribe,
    () => select(state),
    () => select(initial),
  );
}
