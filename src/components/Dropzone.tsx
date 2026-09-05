"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";

import { useFileImport } from "@/hooks/useFileImport";
import { FORMAT_LIST, MAX_FILE_BYTES } from "@/lib/formats";

const ACCEPT = FORMAT_LIST.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(",");

export function Dropzone({
  onImported,
  compact = false,
}: {
  onImported?: () => void;
  compact?: boolean;
}) {
  const { importFile, isImporting } = useFileImport();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOver, setOver] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      setRejected(null);
      const file = files?.[0];
      if (!file) return;

      if (file.size > MAX_FILE_BYTES) {
        setRejected(
          `${file.name} is ${(file.size / (1024 * 1024)).toFixed(1)} MB. The limit is 100 MB.`,
        );
        return;
      }
      const ok = await importFile(file);
      if (ok) onImported?.();
    },
    [importFile, onImported],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setOver(false);
      void handleFiles(event.dataTransfer.files);
    },
    [handleFiles],
  );

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload a subtitle file by dragging it here or pressing Enter to choose a file"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={
          compact
            ? `flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition ${
                isOver
                  ? "border-accent-500 bg-accent-50"
                  : "border-slate-300 bg-slate-50 hover:border-brand-400 hover:bg-brand-50/50"
              }`
            : `flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-14 text-center transition sm:py-20 ${
                isOver
                  ? "border-accent-500 bg-accent-50 shadow-inner"
                  : "border-slate-300 bg-white hover:border-brand-400 hover:bg-brand-50/40"
              }`
        }
      >
        <span
          aria-hidden="true"
          className={`grid place-items-center rounded-2xl bg-gradient-to-br from-brand-600 to-accent-600 text-white shadow-md ${
            compact ? "h-10 w-10 text-lg" : "h-14 w-14 text-2xl"
          }`}
        >
          ↑
        </span>

        <p className={`mt-4 font-semibold text-slate-900 ${compact ? "text-sm" : "text-lg"}`}>
          {isImporting ? "Reading your file…" : "Drop a subtitle file here"}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          or click to browse · up to 100 MB · nothing is uploaded
        </p>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(event) => void handleFiles(event.target.files)}
        />
      </div>

      {rejected && (
        <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {rejected}
        </p>
      )}
    </div>
  );
}
