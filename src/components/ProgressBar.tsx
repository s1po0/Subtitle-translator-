"use client";

import { translationProgress } from "@/lib/types";
import type { SubtitleEntry } from "@/lib/types";

export function ProgressBar({
  entries,
  compact = false,
}: {
  entries: SubtitleEntry[];
  compact?: boolean;
}) {
  const { total, translated, percent } = translationProgress(entries);

  if (total === 0) {
    return (
      <p className="text-sm text-slate-500">No subtitles loaded yet.</p>
    );
  }

  return (
    <div className={compact ? "" : "w-full"}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-slate-700">
          Translation progress
        </span>
        <span className="text-sm tabular-nums text-slate-600">
          <span className="font-semibold text-accent-700">{translated}</span>
          {" / "}
          {total} subtitles · {percent}%
        </span>
      </div>

      <div
        className={`w-full overflow-hidden rounded-full bg-slate-200 ${
          compact ? "h-1.5" : "h-2.5"
        }`}
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Translation progress: ${translated} of ${total} subtitles`}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-500 to-accent-500 transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
