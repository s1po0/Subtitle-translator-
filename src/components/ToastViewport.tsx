"use client";

import { useToast, type ToastKind } from "@/lib/toast-context";

const STYLES: Record<ToastKind, { container: string; icon: string; label: string }> = {
  info: {
    container: "border-brand-200 bg-brand-50 text-brand-900",
    icon: "text-brand-600",
    label: "Information",
  },
  success: {
    container: "border-accent-200 bg-accent-50 text-accent-900",
    icon: "text-accent-600",
    label: "Success",
  },
  warning: {
    container: "border-amber-200 bg-amber-50 text-amber-900",
    icon: "text-amber-600",
    label: "Warning",
  },
  error: {
    container: "border-red-200 bg-red-50 text-red-900",
    icon: "text-red-600",
    label: "Error",
  },
};

const GLYPHS: Record<ToastKind, string> = {
  info: "ⓘ",
  success: "✓",
  warning: "⚠",
  error: "✕",
};

export function ToastViewport() {
  const { toasts, dismiss } = useToast();

  return (
    <>
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((toast) => {
          const style = STYLES[toast.kind];
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg ${style.container}`}
            >
              <span aria-hidden="true" className={`text-lg leading-none ${style.icon}`}>
                {GLYPHS[toast.kind]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{toast.title}</p>
                {toast.detail && <p className="mt-0.5 text-sm opacity-90">{toast.detail}</p>}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="rounded-md p-1 text-current opacity-60 hover:opacity-100"
                aria-label={`Dismiss ${style.label.toLowerCase()} message`}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {/* Screen-reader announcements, kept in sync with the visible toasts. */}
      <div aria-live="polite" aria-atomic="false" className="sr-only">
        {toasts.map((toast) => (
          <p key={toast.id}>
            {STYLES[toast.kind].label}: {toast.title}
            {toast.detail ? `. ${toast.detail}` : ""}
          </p>
        ))}
      </div>
    </>
  );
}
