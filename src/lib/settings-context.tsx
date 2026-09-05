"use client";

/** Settings that persist across sessions via local storage. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { AppSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { loadSettings, saveSettings } from "./storage";

export interface SettingsContextValue {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  reset: () => void;
  isReady: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isReady, setReady] = useState(false);

  // Local storage is only reachable in the browser, so the first render uses
  // defaults and the stored values are applied immediately after mount. This
  // keeps the static export free of hydration mismatches.
  useEffect(() => {
    setSettings(loadSettings());
    setReady(true);
  }, []);

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setSettings({ ...DEFAULT_SETTINGS });
    saveSettings({ ...DEFAULT_SETTINGS });
  }, []);

  const value = useMemo(
    () => ({ settings, update, reset, isReady }),
    [settings, update, reset, isReady],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (context === null) {
    throw new Error("useSettings must be used inside <SettingsProvider>.");
  }
  return context;
}
