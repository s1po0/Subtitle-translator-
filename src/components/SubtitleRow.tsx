"use client";

import { useMemo, useState } from "react";

import { copyText, readText } from "@/lib/clipboard";
import { detectDirection } from "@/lib/languages";
import { isTranslated, type SubtitleEntry } from "@/lib/types";
import type { AppSettings } from "@/lib/types";
import { isValidTime, parseTimeToMs } from "@/lib/time";
import { useToast } from "@/lib/toast-context";

export interface SubtitleRowHandlers {
  onOriginalChange: (id: number, value: string) => void;
  onTranslationChange: (id: number, value: string) => void;
  onTimesChange: (id: number, start: string, end: string) => void;
  onDelete: (ids: number[]) => void;
  onSplit: (id: number) => void;
  onMerge: (id: number) => void;
  onToggleSelect: (id: number) => void;
}

interface Props extends SubtitleRowHandlers {
  entry: SubtitleEntry;
  selected: boolean;
  settings: AppSettings;
  isLast: boolean;
}

/**
 * One subtitle, shown as original beside translation.
 *
 * Timestamps are edited as free text with live validation rather than a masked
 * input, because subtitle editors type times in several shapes and a mask gets
 * in the way; an invalid value is highlighted and simply not committed.
 */
export function SubtitleRow({
  entry,
  selected,
  settings,
  isLast,
  onOriginalChange,
  onTranslationChange,
  onTimesChange,
  onDelete,
  onSplit,
  onMerge,
  onToggleSelect,
}: Props) {
  const { notify } = useToast();
  const [busy, setBusy] = useState<"copy" | "paste" | null>(null);

  const done = isTranslated(entry);
  const durationMs =
    parseTimeToMs(entry.end_time) - parseTimeToMs(entry.start_time);

  const originalDirection =
    settings.originalTextDirection === "auto"
      ? detectDirection(entry.original_text)
      : settings.originalTextDirection;

  const startValid = isValidTime(entry.start_time);
  const endValid = isValidTime(entry.end_time);
  const orderingOk =
    startValid && endValid && parseTimeToMs(entry.end_time) > parseTimeToMs(entry.start_time);

  const styleSummary = useMemo(() => {
    const bits: string[] = [];
    if (entry.style.name) bits.push(String(entry.style.name));
    if (entry.style.speaker) bits.push(`speaker: ${entry.style.speaker}`);
    if (Array.isArray(entry.style.inlineTags) && entry.style.inlineTags.length) {
      bits.push(`${entry.style.inlineTags.length} tag(s)`);
    }
    return bits.join(" · ");
  }, [entry.style]);

  const handleCopy = async () => {
    setBusy("copy");
    try {
      await copyText(entry.original_text);
      notify("success", `Subtitle ${entry.index} copied`, "Paste it into your translator.");
    } catch (err) {
      notify("error", "Copy failed", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const handlePaste = async () => {
    setBusy("paste");
    try {
      const text = await readText();
      onTranslationChange(entry.id, text);
      notify("success", `Translation pasted into subtitle ${entry.index}`);
    } catch (err) {
      notify("error", "Paste failed", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <li
      id={`subtitle-${entry.id}`}
      aria-label={`Subtitle ${entry.index}`}
      className={`row-perf card overflow-hidden transition ${
        selected ? "ring-2 ring-brand-400" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-100 bg-slate-50/70 px-3 py-2 sm:px-4">
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(entry.id)}
            className="h-4 w-4 rounded border-slate-300 text-brand-600"
            aria-label={`Select subtitle ${entry.index}`}
          />
          <span className="tabular-nums">#{entry.index}</span>
        </label>

        <span
          className={`badge ${
            done
              ? "bg-accent-100 text-accent-800"
              : "bg-slate-200 text-slate-600"
          }`}
        >
          {done ? "Translated" : "Not translated"}
        </span>

        <div className="flex items-center gap-1.5">
          <label className="sr-only" htmlFor={`start-${entry.id}`}>
            Start time for subtitle {entry.index}
          </label>
          <input
            id={`start-${entry.id}`}
            className={`w-[8.5rem] rounded-md border px-2 py-1 font-mono text-xs tabular-nums ${
              startValid ? "border-slate-300" : "border-red-400 bg-red-50"
            }`}
            value={entry.start_time}
            onChange={(e) => onTimesChange(entry.id, e.target.value, entry.end_time)}
            aria-invalid={!startValid}
          />
          <span aria-hidden="true" className="text-xs text-slate-400">
            →
          </span>
          <label className="sr-only" htmlFor={`end-${entry.id}`}>
            End time for subtitle {entry.index}
          </label>
          <input
            id={`end-${entry.id}`}
            className={`w-[8.5rem] rounded-md border px-2 py-1 font-mono text-xs tabular-nums ${
              endValid ? "border-slate-300" : "border-red-400 bg-red-50"
            }`}
            value={entry.end_time}
            onChange={(e) => onTimesChange(entry.id, entry.start_time, e.target.value)}
            aria-invalid={!endValid}
          />
        </div>

        {!orderingOk && startValid && endValid && (
          <span className="text-xs font-medium text-amber-700">
            End time must be after start time
          </span>
        )}

        <span className="ml-auto text-xs tabular-nums text-slate-500">
          {(durationMs / 1000).toFixed(1)}s
        </span>

        <div className="flex items-center gap-1">
          <button type="button" className="btn-ghost btn-sm" onClick={() => onSplit(entry.id)}>
            Split
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => onMerge(entry.id)}
            disabled={isLast}
            title={isLast ? "There is no following subtitle to merge with" : "Merge with the next subtitle"}
          >
            Merge
          </button>
          <button
            type="button"
            className="btn-danger btn-sm"
            onClick={() => onDelete([entry.id])}
          >
            Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 p-3 sm:p-4 lg:grid-cols-2">
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label className="label mb-0" htmlFor={`original-${entry.id}`}>
              Original
            </label>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => void handleCopy()}
              disabled={busy === "copy"}
            >
              {busy === "copy" ? "Copying…" : "Copy original"}
            </button>
          </div>
          <textarea
            id={`original-${entry.id}`}
            className="field resize-y font-mono text-[length:inherit]"
            style={{ fontSize: `${settings.fontSize}px`, direction: originalDirection }}
            rows={3}
            dir={originalDirection}
            value={entry.original_text}
            onChange={(e) => onOriginalChange(entry.id, e.target.value)}
            spellCheck={false}
          />
          {styleSummary && (
            <p className="hint truncate" title={styleSummary}>
              Style preserved: {styleSummary}
            </p>
          )}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label className="label mb-0" htmlFor={`translated-${entry.id}`}>
              Kurdish Sorani
              <span className="ml-2 text-xs font-normal text-slate-500">کوردیی سۆرانی</span>
            </label>
            <button
              type="button"
              className="btn-accent btn-sm"
              onClick={() => void handlePaste()}
              disabled={busy === "paste"}
            >
              {busy === "paste" ? "Pasting…" : "Paste translation"}
            </button>
          </div>
          <textarea
            id={`translated-${entry.id}`}
            className={`field resize-y ${
              settings.translationTextDirection === "rtl" ? "rtl-field" : ""
            }`}
            style={{ fontSize: `${settings.fontSize}px` }}
            dir={settings.translationTextDirection}
            lang="ckb"
            rows={3}
            value={entry.translated_text}
            placeholder="کوردیی سۆرانی لێرە بنووسە…"
            onChange={(e) => onTranslationChange(entry.id, e.target.value)}
            spellCheck={false}
          />
        </div>
      </div>
    </li>
  );
}
