// Browser-side store of the preferences (see prefs.ts): read once from
// localStorage, written back on every change. The server render and the
// first client render use the defaults (useSyncExternalStore's server
// snapshot), so hydration never mismatches.

import { useSyncExternalStore } from "react";
import { DEFAULT_PREFS, loadPrefs, savePrefs, type Prefs } from "./prefs";

let current: Prefs | null = null;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function getPrefs(): Prefs {
  return (current ??= loadPrefs(storage()));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function updatePrefs(update: (prefs: Prefs) => Prefs) {
  current = update(getPrefs());
  savePrefs(storage(), current);
  for (const l of listeners) l();
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, getPrefs, () => DEFAULT_PREFS);
}
