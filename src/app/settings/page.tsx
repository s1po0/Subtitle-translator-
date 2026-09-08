"use client";

import { useEffect, useState } from "react";

import { Dropzone } from "@/components/Dropzone";
import { NeuralEnginePanel } from "@/components/NeuralEnginePanel";
import { FORMAT_LIST, FORMATS } from "@/lib/formats";
import { SOURCE_LANGUAGES } from "@/lib/languages";
import {
  clearAllSavedData,
  formatBytes,
  isStorageAvailable,
  listProjectSummaries,
  storageUsageBytes,
} from "@/lib/storage";
import type { FormatId, ProjectSummary } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { useSettings } from "@/lib/settings-context";
import { useToast } from "@/lib/toast-context";
import { useProject } from "@/lib/project-context";

export default function SettingsPage() {
  const { settings, update, reset } = useSettings();
  const { notify } = useToast();
  const { loadSavedProject, closeProject } = useProject();

  // Read from local storage only after mount: touching `window` during the
  // first render would produce a hydration mismatch against the static export.
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [usage, setUsage] = useState(0);
  const [available, setAvailable] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    setProjects(listProjectSummaries());
    setUsage(storageUsageBytes());
    setAvailable(isStorageAvailable());
  }, []);

  const handleClearAll = () => {
    const removed = clearAllSavedData();
    closeProject();
    setProjects([]);
    setUsage(0);
    setConfirmClear(false);
    notify(
      "success",
      removed > 0 ? `Deleted ${removed} saved item${removed === 1 ? "" : "s"}` : "Nothing to delete",
      "All local project data has been removed from this browser.",
    );
  };

  return (
    <div className="py-8 sm:py-10">
      <header className="max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Settings</h1>
        <p className="mt-2 text-slate-600">
          Preferences are stored in this browser only. They are applied the next
          time you open a file.
        </p>
      </header>

      {!available && (
        <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Local storage is unavailable in this browsing context, so preferences and
          projects cannot be saved. Editing still works for the current session.
        </p>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <h2 className="text-lg font-semibold text-slate-900">Defaults</h2>

          <div className="mt-5 space-y-5">
            <div>
              <label className="label" htmlFor="default-source">
                Default source language
              </label>
              <select
                id="default-source"
                className="field"
                value={settings.defaultSourceLanguage}
                onChange={(e) => update({ defaultSourceLanguage: e.target.value })}
              >
                {SOURCE_LANGUAGES.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.name} — {language.nativeName}
                  </option>
                ))}
              </select>
              <p className="hint">
                The target is always Kurdish Sorani and cannot be changed.
              </p>
            </div>

            <div>
              <label className="label" htmlFor="default-export">
                Default export format
              </label>
              <select
                id="default-export"
                className="field"
                value={settings.defaultExportFormat}
                onChange={(e) =>
                  update({ defaultExportFormat: e.target.value as FormatId | "original" })
                }
              >
                <option value="original">Same as the imported file</option>
                {FORMAT_LIST.map((descriptor) => (
                  <option key={descriptor.id} value={descriptor.id}>
                    {descriptor.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="card p-6">
          <h2 className="text-lg font-semibold text-slate-900">Text direction and display</h2>

          <div className="mt-5 space-y-5">
            <div>
              <label className="label" htmlFor="dir-original">
                Original text direction
              </label>
              <select
                id="dir-original"
                className="field"
                value={settings.originalTextDirection}
                onChange={(e) =>
                  update({
                    originalTextDirection: e.target.value as "auto" | "ltr" | "rtl",
                  })
                }
              >
                <option value="auto">Detect from the text</option>
                <option value="ltr">Left to right</option>
                <option value="rtl">Right to left</option>
              </select>
              <p className="hint">
                The translation field is always right to left, matching Arabic script.
              </p>
            </div>

            <div>
              <label className="label" htmlFor="font-size">
                Editor font size: {settings.fontSize}px
              </label>
              <input
                id="font-size"
                type="range"
                min={12}
                max={24}
                step={1}
                value={settings.fontSize}
                onChange={(e) => update({ fontSize: Number(e.target.value) })}
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-brand-600"
              />
              <p
                className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 rtl-field text-sm"
                dir="rtl"
                lang="ckb"
                style={{ fontSize: `${settings.fontSize}px` }}
              >
                نموونەی نووسینی کوردی بۆ پێشبینین
              </p>
            </div>
          </div>
        </section>

        <section className="card p-6">
          <h2 className="text-lg font-semibold text-slate-900">Line breaks on export</h2>

          <div className="mt-5 space-y-5">
            <div>
              <label className="label" htmlFor="line-break">
                Line-break preference
              </label>
              <select
                id="line-break"
                className="field"
                value={settings.lineBreakPreference}
                onChange={(e) =>
                  update({
                    lineBreakPreference: e.target.value as
                      | "original"
                      | "single"
                      | "double",
                  })
                }
              >
                <option value="original">Keep whatever the file used</option>
                <option value="single">Collapse every cue to one line</option>
                <option value="double">Split every cue across two lines</option>
              </select>
            </div>

            <div>
              <label className="label" htmlFor="max-lines">
                Preferred lines per subtitle: {settings.maxLinesPerCue}
              </label>
              <input
                id="max-lines"
                type="range"
                min={1}
                max={3}
                step={1}
                value={settings.maxLinesPerCue}
                onChange={(e) => update({ maxLinesPerCue: Number(e.target.value) })}
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-brand-600"
              />
              <p className="hint">Advisory; used when splitting long lines.</p>
            </div>

            <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
              <input
                type="checkbox"
                checked={settings.autoSave}
                onChange={(e) => update({ autoSave: e.target.checked })}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600"
              />
              <span>
                <span className="block text-sm font-medium text-slate-800">
                  Auto-save to local storage
                </span>
                <span className="block text-xs text-slate-500">
                  Saves your edits shortly after you stop typing.
                </span>
              </span>
            </label>
          </div>
        </section>

        <NeuralEnginePanel />

        <section className="card p-6">
          <h2 className="text-lg font-semibold text-slate-900">Saved projects</h2>
          <p className="mt-1 text-sm text-slate-600">
            Using {formatBytes(usage)} of local storage · {projects.length} project
            {projects.length === 1 ? "" : "s"}
          </p>

          {projects.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {projects.map((project) => (
                <li
                  key={project.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-900">
                      {project.fileName}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {FORMATS[project.format]?.label ?? project.format} ·{" "}
                      {project.translated}/{project.total} translated
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => {
                      if (loadSavedProject(project.id)) {
                        notify("success", "Project opened", project.fileName);
                      } else {
                        notify("error", "That project could not be loaded");
                      }
                    }}
                  >
                    Open
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
              No saved projects yet. Open a subtitle file to create one.
            </p>
          )}

          <div className="mt-5 border-t border-slate-200 pt-4">
            {confirmClear ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                <p className="text-sm font-medium text-red-900">
                  Delete every saved project and preference from this browser? This
                  cannot be undone.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="btn-danger btn-sm" onClick={handleClearAll}>
                    Yes, delete everything
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => setConfirmClear(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="btn-danger"
                onClick={() => setConfirmClear(true)}
              >
                Clear all saved projects
              </button>
            )}
          </div>

          <button
            type="button"
            className="btn-ghost mt-3 text-xs"
            onClick={() => {
              reset();
              notify("success", "Settings restored to defaults");
            }}
          >
            Reset settings to defaults ({DEFAULT_SETTINGS.fontSize}px, auto direction)
          </button>
        </section>
      </div>

      <section className="mt-10 max-w-2xl">
        <h2 className="text-lg font-semibold text-slate-900">Replace the open file</h2>
        <p className="mt-1 text-sm text-slate-600">
          Uploading another file starts a new project; the current one stays saved.
        </p>
        <div className="mt-4">
          <Dropzone compact />
        </div>
      </section>
    </div>
  );
}
