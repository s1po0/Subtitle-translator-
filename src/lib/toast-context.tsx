"use client";

/**
 * Toast notifications for loading, success and error states.
 *
 * Announcements are also published to a polite live region so screen readers
 * hear them without a visual cue.
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

export type ToastKind = "info" | "success" | "warning" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string;
}

export interface ToastContextValue {
  toasts: Toast[];
  notify: (kind: ToastKind, title: string, detail?: string) => void;
  dismiss: (id: number) => void;
  clear: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const LIFETIME_MS: Record<ToastKind, number> = {
  info: 4000,
  success: 3200,
  warning: 7000,
  error: 9000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const notify = useCallback(
    (kind: ToastKind, title: string, detail?: string) => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((prev) => [...prev.slice(-4), { id, kind, title, detail }]);

      const timer = setTimeout(() => dismiss(id), LIFETIME_MS[kind]);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  const clear = useCallback(() => {
    timers.current.forEach((timer) => clearTimeout(timer));
    timers.current.clear();
    setToasts([]);
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const value = useMemo(
    () => ({ toasts, notify, dismiss, clear }),
    [toasts, notify, dismiss, clear],
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context === null) {
    throw new Error("useToast must be used inside <ToastProvider>.");
  }
  return context;
}
