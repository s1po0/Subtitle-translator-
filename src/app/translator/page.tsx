"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { Dropzone } from "@/components/Dropzone";
import { ExportDialog } from "@/components/ExportDialog";
import { PreviewPanel } from "@/components/PreviewPanel";
import { ProgressBar } from "@/components/ProgressBar";
import { SubtitleRow } from "@/components/SubtitleRow";
import { FORMATS } from "@/lib/formats";
import { SOURCE_LANGUAGES } from "@/lib/languages";
import { copyText } from "@/lib/clipboard";
import { useProject, type ReplaceScope } from "@/lib/project-context";
import { useSettings } from "@/lib/settings-context";
import { useToast } from "@/lib/toast-context";
import { translationProgress } from "@/lib/types";

export default function TranslatorPage() {
  const {
    doc,
    entries,
    selection,
    isDirty,
    canUndo,
    canRedo,
    storageNotice,
    warnings,
    setSourceLanguage,
    setTranslation,
    setOriginal,
    setTimes,
    addEntry,
    deleteEntries,
    splitEntry,
    mergeWithNext,
    searchReplace,
    toggleSelect,
    selectAll,
    clearSelection,
    undo,
    redo,
    saveNow,
  } = useProject();

  const { settings } = useSettings();
  const { notify } = useToast();

  const [showExport, setShowExport] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [find, setFind] = useState("");
  const [replaceWith, setReplaceWith] = useState("");
  const [scope, setScope] = useState<ReplaceScope>("translation");
  const [dismissedWarnings, setDismissedWarnings] = useState(false);

  const progress = useMemo(() => translationProgress(entries), [entries]);
  const untranslatedCount = progress.total - progress.translated;

  if (doc === null) {
    return (
      <div className="mx-auto max-w-2xl py-14">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Translator</h1>
        <p className="mt-2 text-slate-600">
          No file is open. Upload a subtitle file to begin — it is parsed locally and
          nothing is sent anywhere.
        </p>
        <div className="mt-6">
          <Dropzone />
        </div>
      </div>
    );
  }

  const format = FORMATS[doc.format];

  const handleCopyAll = async () => {
    const targetIds = selection.size > 0 ? selection : new Set(entries.map((e) => e.id));
    const text = entries
      .filter((e) => targetIds.has(e.id))
      .map((e) => `${e.index}. ${e.original_text.replace(/\n/g, " ")}`)
      .join("\n");
    try {
      await copyText(text);
      notify(
        "success",
        `Copied ${targetIds.size} original line${targetIds.size === 1 ? "" : "s"}`,
        "Numbered so you can line the translations back up.",
      );
    } catch (err) {
      notify("error", "Copy failed", err instanceof Error ? err.message : undefined);
    }
  };

  const handleRunReplace = () => {
    const count = searchReplace(find, replaceWith, scope);
    notify(
      count > 0 ? "success" : "info",
      count > 0 ? `Replaced ${count} occurrence${count === 1 ? "" : "s"}` : "Nothing matched",
      `Searched in: ${scope}.`,
    );
  };

  const visibleWarnings = dismissedWarnings ? [] : warnings;

  return (
    <div className="py-6 sm:py-8">
      {/* ---------------------------------------------------------- *
       * Header: file, languages, progress
       * ---------------------------------------------------------- */}
      <header className="card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-lg font-semibold text-slate-900" title={doc.fileName}>
                {doc.fileName}
              </h1>
              <span className="badge bg-brand-100 text-brand-800">{format.label}</span>
              {isDirty ? (
                <span className="badge bg-amber-100 text-amber-800">Unsaved changes</span>
              ) : (
                <span className="badge bg-slate-100 text-slate-600">Saved locally</span>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {progress.total} subtitles · source detected as {format.label}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={saveNow}>
              Save now
            </button>
            <button type="button" className="btn-accent" onClick={() => setShowExport(true)}>
              Export &amp; download
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-[auto_auto_1fr] sm:items-end">
          <div>
            <label className="label" htmlFor="source-language">
              Source language
            </label>
            <select
              id="source-language"
              className="field sm:w-56"
              value={doc.sourceLanguage}
              onChange={(e) => setSourceLanguage(e.target.value)}
            >
              {SOURCE_LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.name} — {language.nativeName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="label">Target language</span>
            <div
              className="field flex items-center gap-2 border-accent-200 bg-accent-50 text-accent-900 sm:w-56"
              aria-readonly="true"
              title="The target is always Kurdish Sorani"
            >
              <span className="rtl-field text-base">کوردیی سۆرانی</span>
              <span className="ml-auto text-xs text-accent-700">fixed · ckb</span>
            </div>
          </div>

          <ProgressBar entries={entries} />
        </div>

        {storageNotice && (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          >
            {storageNotice}
          </p>
        )}
      </header>

      {/* ---------------------------------------------------------- *
       * Format warnings
       * ---------------------------------------------------------- */}
      {visibleWarnings.length > 0 && (
        <section className="card mt-4 border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-amber-900">
                Formatting that could not be fully preserved
              </h2>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-amber-800">
                {visibleWarnings.map((warning, i) => (
                  <li key={`${warning}-${i}`}>{warning}</li>
                ))}
              </ul>
            </div>
            <button
              type="button"
              className="btn-ghost btn-sm shrink-0"
              onClick={() => setDismissedWarnings(true)}
            >
              Dismiss
            </button>
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------- *
       * Toolbar
       * ---------------------------------------------------------- */}
      <section
        className="card sticky top-[4.25rem] z-30 mt-4 p-3 shadow-md"
        aria-label="Editing toolbar"
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={undo}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
            >
              ↶ Undo
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={redo}
              disabled={!canRedo}
              title="Redo (Ctrl+Shift+Z)"
            >
              ↷ Redo
            </button>
          </div>

          <span aria-hidden="true" className="h-5 w-px bg-slate-200" />

          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => {
              const id = addEntry();
              if (id !== null) {
                notify("success", "Subtitle added");
                setTimeout(
                  () =>
                    document
                      .getElementById(`subtitle-${id}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "center" }),
                  50,
                );
              }
            }}
          >
            + Add subtitle
          </button>

          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setShowReplace((v) => !v)}
            aria-expanded={showReplace}
          >
            ⇄ Search &amp; replace
          </button>

          <span aria-hidden="true" className="h-5 w-px bg-slate-200" />

          <button type="button" className="btn-secondary btn-sm" onClick={() => void handleCopyAll()}>
            ⧉ Copy originals{selection.size > 0 ? ` (${selection.size})` : " (all)"}
          </button>
          <button type="button" className="btn-ghost btn-sm" onClick={selectAll}>
            Select all
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={clearSelection}
            disabled={selection.size === 0}
          >
            Clear selection
          </button>
          <button
            type="button"
            className="btn-danger btn-sm"
            onClick={() => {
              deleteEntries([...selection]);
              notify("success", `Deleted ${selection.size} subtitle(s)`);
            }}
            disabled={selection.size === 0}
          >
            Delete selected
          </button>

          <span className="ml-auto text-xs text-slate-500">
            {untranslatedCount > 0
              ? `${untranslatedCount} still to translate`
              : "Everything is translated ✓"}
          </span>
        </div>

        {showReplace && (
          <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-[1fr_1fr_auto_auto]">
            <div>
              <label className="label" htmlFor="find">
                Find
              </label>
              <input
                id="find"
                className="field"
                value={find}
                onChange={(e) => setFind(e.target.value)}
                placeholder="Text to look for"
              />
            </div>
            <div>
              <label className="label" htmlFor="replace-with">
                Replace with
              </label>
              <input
                id="replace-with"
                className="field rtl-field"
                dir="rtl"
                value={replaceWith}
                onChange={(e) => setReplaceWith(e.target.value)}
                placeholder="…و بە"
              />
            </div>
            <div>
              <label className="label" htmlFor="replace-scope">
                Apply to
              </label>
              <select
                id="replace-scope"
                className="field"
                value={scope}
                onChange={(e) => setScope(e.target.value as ReplaceScope)}
              >
                <option value="translation">Translations only</option>
                <option value="original">Originals only</option>
                <option value="both">Both</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                className="btn-primary w-full sm:w-auto"
                onClick={handleRunReplace}
                disabled={!find}
              >
                Replace all
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------- *
       * Body: list + preview
       * ---------------------------------------------------------- */}
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section aria-label="Subtitles">
          {entries.length === 0 ? (
            <div className="card p-10 text-center">
              <p className="text-slate-600">
                This file parsed, but it contains no subtitles.
              </p>
              <Link href="/" className="btn-primary mt-4">
                Choose another file
              </Link>
            </div>
          ) : (
            <ul className="space-y-3">
              {entries.map((entry, i) => (
                <SubtitleRow
                  key={entry.id}
                  entry={entry}
                  selected={selection.has(entry.id)}
                  settings={settings}
                  isLast={i === entries.length - 1}
                  onOriginalChange={setOriginal}
                  onTranslationChange={setTranslation}
                  onTimesChange={setTimes}
                  onDelete={deleteEntries}
                  onSplit={splitEntry}
                  onMerge={mergeWithNext}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </ul>
          )}
        </section>

        <aside className="space-y-4 xl:sticky xl:top-[4.25rem] xl:self-start">
          <PreviewPanel entries={entries} />

          <section className="card p-4">
            <h2 className="text-sm font-semibold text-slate-900">Keyboard shortcuts</h2>
            <dl className="mt-2 space-y-1 text-xs text-slate-600">
              <div className="flex justify-between gap-3">
                <dt>Undo</dt>
                <dd className="font-mono">Ctrl/⌘ + Z</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Redo</dt>
                <dd className="font-mono">Ctrl/⌘ + Shift + Z</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Move between fields</dt>
                <dd className="font-mono">Tab</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>

      {showExport && <ExportDialog doc={doc} onClose={() => setShowExport(false)} />}
    </div>
  );
}
