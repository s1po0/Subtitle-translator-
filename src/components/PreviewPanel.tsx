"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { sanitizeSubtitleHtml, stripAllMarkup } from "@/lib/sanitize";
import { formatDuration, parseTimeToMs } from "@/lib/time";
import type { SubtitleEntry } from "@/lib/types";
import { translationProgress } from "@/lib/types";

type View = "translated" | "original" | "both";

/**
 * Preview panel.
 *
 * A mock player frame with a scrubbable timeline. Text is rendered through the
 * sanitiser, so only whitelisted subtitle tags become HTML and anything else
 * (including `<script>` or event-handler attributes) is escaped as text.
 */
export function PreviewPanel({ entries }: { entries: SubtitleEntry[] }) {
  const [view, setView] = useState<View>("translated");
  const [positionMs, setPositionMs] = useState(0);
  const [isPlaying, setPlaying] = useState(false);
  const frameRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);

  const totalMs = useMemo(() => {
    if (entries.length === 0) return 0;
    return Math.max(...entries.map((e) => parseTimeToMs(e.end_time)));
  }, [entries]);

  const active = useMemo(() => {
    for (const entry of entries) {
      const start = parseTimeToMs(entry.start_time);
      const end = parseTimeToMs(entry.end_time);
      if (positionMs >= start && positionMs <= end) return entry;
    }
    return null;
  }, [entries, positionMs]);

  const step = useCallback(
    (deltaMs: number, timestamp?: number) => {
      setPositionMs((prev) => {
        const next = Math.max(0, Math.min(totalMs, prev + deltaMs));
        if (totalMs > 0 && next >= totalMs) setPlaying(false);
        return next;
      });
      if (timestamp !== undefined) lastTickRef.current = timestamp;
    },
    [totalMs],
  );

  useEffect(() => {
    if (!isPlaying) return;
    const tick = (timestamp: number) => {
      const last = lastTickRef.current ?? timestamp;
      const elapsed = timestamp - last;
      lastTickRef.current = timestamp;
      step(elapsed);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      lastTickRef.current = null;
    };
  }, [isPlaying, step]);

  // A newly loaded document should not keep an out-of-range playhead.
  useEffect(() => {
    if (positionMs > totalMs) setPositionMs(0);
  }, [totalMs, positionMs]);

  const renderText = (entry: SubtitleEntry, which: "original" | "translated"): string => {
    const value = which === "original" ? entry.original_text : entry.translated_text;
    if (!value.trim()) return "";
    return sanitizeSubtitleHtml(value);
  };

  const progress = translationProgress(entries);
  const showMarkup = entries.some(
    (e) => /<\/?[a-zA-Z]/.test(e.original_text) || /\{\\/.test(e.original_text),
  );

  if (entries.length === 0) {
    return (
      <div className="card p-6 text-center text-sm text-slate-500">
        Load a subtitle file to see a live preview.
      </div>
    );
  }

  return (
    <section className="card overflow-hidden" aria-label="Subtitle preview">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Preview</h2>
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Preview text source">
          {(
            [
              ["translated", "Sorani"],
              ["original", "Original"],
              ["both", "Both"],
            ] as Array<[View, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setView(value)}
              aria-pressed={view === value}
              className={
                view === value
                  ? "rounded-md bg-white px-2.5 py-1 text-xs font-medium text-brand-700 shadow-sm"
                  : "rounded-md px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-900"
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="preview-frame relative aspect-video w-full">
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-1 px-[6%] pb-[7%] text-center">
          {active === null ? (
            <p className="text-sm text-white/40">— no subtitle at this moment —</p>
          ) : (
            <>
              {(view === "translated" || view === "both") &&
                (active.translated_text.trim() ? (
                  <p
                    className="subtitle-text text-lg leading-relaxed text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.9)] sm:text-2xl"
                    dir="rtl"
                    lang="ckb"
                    // Sanitised: only <i> <b> <u> <br> <font color> survive.
                    dangerouslySetInnerHTML={{ __html: renderText(active, "translated") }}
                  />
                ) : (
                  <p className="text-base text-amber-300/90 sm:text-lg" dir="rtl" lang="ckb">
                    وەرگێڕان نەکراوە
                  </p>
                ))}
              {(view === "original" || view === "both") && (
                <p
                  className="text-sm text-white/75 [text-shadow:0_1px_3px_rgba(0,0,0,0.9)] sm:text-lg"
                  dangerouslySetInnerHTML={{ __html: renderText(active, "original") }}
                />
              )}
            </>
          )}
        </div>

        <span className="absolute right-3 top-3 rounded bg-black/40 px-2 py-0.5 font-mono text-xs tabular-nums text-white/80">
          #{active ? active.index : "–"}
        </span>
      </div>

      <div className="space-y-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setPlaying((p) => !p)}
            aria-label={isPlaying ? "Pause preview" : "Play preview"}
          >
            {isPlaying ? "❚❚ Pause" : "▶ Play"}
          </button>

          <label className="sr-only" htmlFor="preview-scrubber">
            Preview position
          </label>
          <input
            id="preview-scrubber"
            type="range"
            min={0}
            max={Math.max(totalMs, 1)}
            step={100}
            value={Math.min(positionMs, totalMs)}
            onChange={(e) => setPositionMs(Number(e.target.value))}
            className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-brand-600"
          />

          <span className="font-mono text-xs tabular-nums text-slate-600">
            {formatDuration(positionMs)} / {formatDuration(totalMs)}
          </span>
        </div>

        <p className="text-xs text-slate-500">
          {progress.translated} of {progress.total} translated
          {showMarkup && " · markup is rendered after sanitisation"}
          {" · "}
          <button
            type="button"
            className="underline decoration-dotted hover:text-brand-700"
            onClick={() => {
              const target = active ?? entries[0];
              if (!target) return;
              document
                .getElementById(`subtitle-${target.id}`)
                ?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
          >
            jump to current subtitle
          </button>
        </p>
        <p className="sr-only">
          {active ? stripAllMarkup(active.translated_text || active.original_text) : "No subtitle"}
        </p>
      </div>
    </section>
  );
}
