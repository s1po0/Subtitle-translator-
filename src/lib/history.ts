"use client";

import { useCallback, useMemo, useRef, useState } from "react";

export interface History<T> {
  state: T;
  /** Replace the current state, pushing the previous one onto the undo stack. */
  set: (next: T | ((prev: T) => T)) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  reset: (value: T) => void;
}

const MAX_HISTORY = 100;

/**
 * Undo/redo over an immutable state value.
 *
 * Snapshots are the values themselves, so callers must treat state as
 * immutable (which React state already encourages). Keeping the stacks in refs
 * rather than state avoids re-rendering on every keystroke while still
 * reporting `canUndo`/`canRedo` accurately.
 */
export function useHistory<T>(initial: T): History<T> {
  const [state, setState] = useState<T>(initial);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const [, forceRender] = useState(0);

  const sync = useCallback(() => forceRender((n) => n + 1), []);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setState((prev) => {
        const value = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        if (Object.is(value, prev)) return prev;
        past.current = [...past.current.slice(-(MAX_HISTORY - 1)), prev];
        future.current = [];
        return value;
      });
      sync();
    },
    [sync],
  );

  const undo = useCallback(() => {
    setState((prev) => {
      if (past.current.length === 0) return prev;
      const previous = past.current[past.current.length - 1];
      past.current = past.current.slice(0, -1);
      future.current = [prev, ...future.current].slice(0, MAX_HISTORY);
      return previous;
    });
    sync();
  }, [sync]);

  const redo = useCallback(() => {
    setState((prev) => {
      if (future.current.length === 0) return prev;
      const [next, ...rest] = future.current;
      future.current = rest;
      past.current = [...past.current.slice(-(MAX_HISTORY - 1)), prev];
      return next;
    });
    sync();
  }, [sync]);

  const reset = useCallback(
    (value: T) => {
      past.current = [];
      future.current = [];
      setState(value);
      sync();
    },
    [sync],
  );

  return useMemo(
    () => ({
      state,
      set,
      undo,
      redo,
      reset,
      canUndo: past.current.length > 0,
      canRedo: future.current.length > 0,
    }),
    [state, set, undo, redo, reset, past.current.length, future.current.length],
  );
}
