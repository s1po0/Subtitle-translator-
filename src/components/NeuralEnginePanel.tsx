"use client";

import { useNeural } from "@/lib/neural/context";
import { MODEL_DOWNLOAD_LABEL, MODEL_ID } from "@/lib/neural/engine";
import { useToast } from "@/lib/toast-context";

const STATE_LABEL: Record<string, string> = {
  disabled: "Off",
  idle: "Enabled, not loaded",
  loading: "Loading model…",
  ready: "Ready",
  error: "Error",
};

/**
 * Controls for the embedded neural engine.
 *
 * The privacy wording here is deliberate: the engine makes a network request
 * (once) to fetch weights, which is a real difference from the rest of the app.
 * Saying so in the panel is better than burying it in a README.
 */
export function NeuralEnginePanel() {
  const { state, error, enabled, progress, support, enable, disable, removeWeights } =
    useNeural();
  const { notify } = useToast();

  const percent =
    progress?.loaded && progress?.total
      ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
      : null;

  return (
    <section className="card p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Neural engine <span className="text-sm font-normal text-slate-500">(optional)</span>
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Runs NLLB-200 (600M) locally to draft Kurdish Sorani translations.
            No API key, no server — inference happens on your device.
          </p>
        </div>
        <span
          className={
            state === "ready"
              ? "badge shrink-0 bg-accent-100 text-accent-800"
              : state === "error"
                ? "badge shrink-0 bg-red-100 text-red-800"
                : "badge shrink-0 bg-slate-100 text-slate-600"
          }
        >
          {STATE_LABEL[state] ?? state}
        </span>
      </div>

      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-slate-500">Model</dt>
        <dd className="font-mono text-xs text-slate-700">{MODEL_ID}</dd>
        <dt className="text-slate-500">Download</dt>
        <dd className="text-slate-700">
          {MODEL_DOWNLOAD_LABEL}, once, then cached by your browser
        </dd>
        <dt className="text-slate-500">Runtime</dt>
        <dd className="text-slate-700">{support.detail}</dd>
      </dl>

      {progress && (
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-slate-600">
            <span>{progress.status}</span>
            <span className="tabular-nums">{percent === null ? "…" : `${percent}%`}</span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-slate-200"
            role="progressbar"
            aria-valuenow={percent ?? 0}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Model download progress"
          >
            <div
              className="h-full rounded-full bg-brand-500 transition-[width] duration-200"
              style={{ width: `${percent ?? 5}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-200 pt-4">
        {!enabled ? (
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              void enable().then(() => {
                if (state !== "error") notify("success", "Neural engine ready");
              });
            }}
            disabled={!support.supported}
          >
            Enable and download model
          </button>
        ) : (
          <button type="button" className="btn-secondary" onClick={disable}>
            Disable
          </button>
        )}

        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={() => {
            void removeWeights().then((removed) => {
              notify(
                "success",
                removed > 0
                  ? `Removed ${removed} cached model file(s)`
                  : "No cached model files found",
              );
            });
          }}
        >
          Remove downloaded weights
        </button>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        <strong className="font-semibold text-slate-600">Privacy note:</strong> while
        this is off, the app makes no network requests at all. Enabling it
        downloads the model weights once from the Hugging Face Hub; after that,
        inference is entirely local. Subtitle text is never sent anywhere, in
        either mode.
      </p>
    </section>
  );
}
