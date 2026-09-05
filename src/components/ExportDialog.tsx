"use client";

import { useEffect, useMemo, useState } from "react";

import {
  exportSubtitle,
  exportWarnings,
  FORMAT_LIST,
  FORMATS,
  suggestFileName,
} from "@/lib/formats";
import type { FormatId, SubtitleDocument } from "@/lib/types";
import { translationProgress } from "@/lib/types";
import { useSettings } from "@/lib/settings-context";
import { useToast } from "@/lib/toast-context";
import { copyText } from "@/lib/clipboard";

/**
 * Export and download.
 *
 * Everything is produced in the browser and handed to the user through a Blob
 * URL: there is no server round trip of any kind. Warnings about lossy
 * conversions (character set, dropped styling) are shown *before* the download
 * so the user is not surprised by an unusable file.
 */
export function ExportDialog({
  doc,
  onClose,
}: {
  doc: SubtitleDocument;
  onClose: () => void;
}) {
  const { settings } = useSettings();
  const { notify } = useToast();

  const [format, setFormat] = useState<FormatId>(
    settings.defaultExportFormat === "original" ? doc.format : settings.defaultExportFormat,
  );
  const [fileName, setFileName] = useState(() => suggestFileName(doc, doc.format, true));
  const [preview, setPreview] = useState("");
  const [isBinary, setBinary] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const warnings = useMemo(() => exportWarnings(doc, format), [doc, format]);
  const progress = translationProgress(doc.entries);

  // Keep the suggested name in step with the chosen format.
  useEffect(() => {
    setFileName(suggestFileName(doc, format, true));
  }, [doc, format]);

  useEffect(() => {
    try {
      const result = exportSubtitle(doc, format, {
        lineBreakPreference: settings.lineBreakPreference,
        fps: Number(doc.formatMeta.frameRate ?? doc.formatMeta.fps ?? 25),
      });
      if (typeof result === "string") {
        setPreview(result.slice(0, 4000));
        setBinary(false);
      } else {
        setPreview(
          `Binary ${FORMATS[format].label} output: ${result.length} bytes ` +
            `(${FORMATS[format].extensions[0]} file).`,
        );
        setBinary(true);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
      setPreview("");
    }
  }, [doc, format, settings.lineBreakPreference]);

  const download = () => {
    try {
      const result = exportSubtitle(doc, format, {
        lineBreakPreference: settings.lineBreakPreference,
        fps: Number(doc.formatMeta.frameRate ?? doc.formatMeta.fps ?? 25),
      });

      // STL is UTF-8 text-safe; every other binary output is raw bytes.
      const blob =
        typeof result === "string"
          ? new Blob([result], { type: "text/plain;charset=utf-8" })
          : new Blob([result as unknown as BlobPart], { type: "application/octet-stream" });

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName || `subtitles.${FORMATS[format].extensions[0]}`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      notify("success", "Download started", anchor.download);
    } catch (err) {
      notify("error", "Export failed", err instanceof Error ? err.message : undefined);
    }
  };

  const copyOutput = async () => {
    if (isBinary) {
      notify("warning", "Binary formats cannot be copied as text");
      return;
    }
    try {
      await copyText(preview.length >= 4000 ? await fullText() : preview);
      notify("success", "Output copied to clipboard");
    } catch (err) {
      notify("error", "Copy failed", err instanceof Error ? err.message : undefined);
    }
  };

  const fullText = async (): Promise<string> => {
    const result = exportSubtitle(doc, format, {
      lineBreakPreference: settings.lineBreakPreference,
    });
    return typeof result === "string" ? result : "";
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-title"
    >
      <div className="card max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-b-none sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 id="export-title" className="text-lg font-semibold text-slate-900">
              Export subtitles
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {progress.translated} of {progress.total} translated · generated in your
              browser
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={onClose}
            aria-label="Close export dialog"
          >
            ✕
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <div>
            <label className="label" htmlFor="export-format">
              Output format
            </label>
            <select
              id="export-format"
              className="field"
              value={format}
              onChange={(e) => setFormat(e.target.value as FormatId)}
            >
              <option value={doc.format} disabled>
                — Original ({FORMATS[doc.format].label}) —
              </option>
              {FORMAT_LIST.map((descriptor) => (
                <option key={descriptor.id} value={descriptor.id}>
                  {descriptor.label}
                  {descriptor.charset !== "unicode" ? " — cannot store Arabic script" : ""}
                </option>
              ))}
            </select>
            <p className="hint">{FORMATS[format].note}</p>
          </div>

          <div>
            <label className="label" htmlFor="export-filename">
              File name
            </label>
            <input
              id="export-filename"
              className="field font-mono"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
            />
          </div>

          {warnings.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5">
              <p className="text-sm font-semibold text-amber-900">
                Before you export
              </p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-amber-800">
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </p>
          )}

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="label mb-0">Output preview</span>
              {!isBinary && (
                <button type="button" className="btn-secondary btn-sm" onClick={() => void copyOutput()}>
                  Copy output
                </button>
              )}
            </div>
            <pre className="max-h-56 overflow-auto rounded-xl border border-slate-200 bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-100">
              {preview || "Nothing to export."}
            </pre>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-accent"
            onClick={download}
            disabled={error !== null || doc.entries.length === 0}
          >
            Download {FORMATS[format].extensions[0].toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  );
}
