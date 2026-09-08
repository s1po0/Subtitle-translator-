"use client";

/**
 * React binding for the neural engine.
 *
 * The engine is opt-in: `neuralEngineEnabled` in settings defaults to false, and
 * while it is false this provider does not even import the runtime. That is what
 * keeps the "no network requests unless you ask for it" guarantee real rather
 * than aspirational.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  clearModelCache,
  NeuralEngine,
  runtimeSupport,
  type EngineProgress,
  type EngineState,
} from "./engine";
import { useSettings } from "../settings-context";

export interface NeuralContextValue {
  state: EngineState;
  error: string | null;
  enabled: boolean;
  progress: EngineProgress | null;
  support: { supported: boolean; detail: string };
  enable: () => Promise<void>;
  disable: () => void;
  removeWeights: () => Promise<number>;
  draft: (text: string, sourceCode: string) => Promise<string>;
}

const NeuralContext = createContext<NeuralContextValue | null>(null);

export function NeuralProvider({ children }: { children: ReactNode }) {
  const { settings, update } = useSettings();
  const enabled = settings.neuralEngineEnabled;

  const [state, setState] = useState<EngineState>("disabled");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<EngineProgress | null>(null);

  const engineRef = useRef<NeuralEngine | null>(null);
  if (engineRef.current === null) {
    engineRef.current = new NeuralEngine({
      onChange: (next, err) => {
        setState(next);
        setError(err);
      },
    });
  }
  const engine = engineRef.current;

  const support = useMemo(() => runtimeSupport(), []);

  const enable = useCallback(async () => {
    update({ neuralEngineEnabled: true });
    try {
      await engine.load((p) => {
        setProgress(p);
        if (p.status === "done" || p.status === "ready") setProgress(null);
      });
      setProgress(null);
    } catch {
      // The engine records the message; the UI reads it from `error`.
    }
  }, [engine, update]);

  const disable = useCallback(() => {
    engine.unload();
    setProgress(null);
    update({ neuralEngineEnabled: false });
  }, [engine, update]);

  const removeWeights = useCallback(async () => {
    engine.unload();
    setProgress(null);
    return clearModelCache();
  }, [engine]);

  const draft = useCallback(
    (text: string, sourceCode: string) => engine.translate(text, sourceCode),
    [engine],
  );

  // If the setting was enabled in a previous session, reload on mount so the
  // engine is ready when the user returns. Weights come from the browser cache.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (enabled) void enable();
    // Intentionally run once; `enable` is stable enough for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<NeuralContextValue>(
    () => ({
      state,
      error,
      enabled,
      progress,
      support,
      enable,
      disable,
      removeWeights,
      draft,
    }),
    [state, error, enabled, progress, support, enable, disable, removeWeights, draft],
  );

  return <NeuralContext.Provider value={value}>{children}</NeuralContext.Provider>;
}

export function useNeural(): NeuralContextValue {
  const context = useContext(NeuralContext);
  if (context === null) {
    throw new Error("useNeural must be used inside <NeuralProvider>.");
  }
  return context;
}
