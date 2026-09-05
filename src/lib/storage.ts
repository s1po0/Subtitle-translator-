/**
 * localStorage persistence.
 *
 * All project data stays on the user's device. Every call is guarded: private
 * browsing modes throw on write, and a large subtitle file can exceed the
 * ~5 MB quota, so both cases surface as a typed error the UI can explain
 * rather than a silent failure.
 */

import type { AppSettings, ProjectSummary, SubtitleDocument } from "./types";
import { DEFAULT_SETTINGS, isTranslated } from "./types";

const NS = "kst";
const PROJECT_KEY = (id: string) => `${NS}.project.${id}`;
const INDEX_KEY = `${NS}.projectIndex`;
const SETTINGS_KEY = `${NS}.settings`;
const ACTIVE_KEY = `${NS}.activeProject`;

export const STORAGE_VERSION = 1;

export class StorageError extends Error {
  constructor(
    message: string,
    readonly kind: "unavailable" | "quota" | "corrupt",
  ) {
    super(message);
    this.name = "StorageError";
  }
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    const probe = "__kst_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

function read<T>(key: string): T | null {
  const store = storage();
  if (!store) return null;
  const raw = store.getItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new StorageError(`Saved data under "${key}" is corrupt.`, "corrupt");
  }
}

function write(key: string, value: unknown): void {
  const store = storage();
  if (!store) {
    throw new StorageError(
      "Local storage is unavailable (private browsing or blocked cookies). " +
        "Your work stays in memory for this session only.",
      "unavailable",
    );
  }
  try {
    store.setItem(key, JSON.stringify(value));
  } catch (err) {
    const isQuota =
      err instanceof DOMException &&
      (err.name === "QuotaExceededError" ||
        err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
        err.code === 22);
    throw new StorageError(
      isQuota
        ? "Local storage is full. Delete an old project to free space."
        : "Could not write to local storage.",
      isQuota ? "quota" : "unavailable",
    );
  }
}

export function isStorageAvailable(): boolean {
  return storage() !== null;
}

/* ------------------------------------------------------------------ *
 * Projects
 * ------------------------------------------------------------------ */

export function listProjectSummaries(): ProjectSummary[] {
  const index = read<ProjectSummary[]>(INDEX_KEY);
  if (!Array.isArray(index)) return [];
  return index.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveProject(doc: SubtitleDocument): void {
  const updated: SubtitleDocument = { ...doc, updatedAt: Date.now() };
  write(PROJECT_KEY(updated.id), updated);

  const summary: ProjectSummary = {
    id: updated.id,
    fileName: updated.fileName,
    format: updated.format,
    total: updated.entries.length,
    translated: updated.entries.filter(isTranslated).length,
    updatedAt: updated.updatedAt,
  };

  const index = listProjectSummaries().filter((p) => p.id !== updated.id);
  index.push(summary);
  write(INDEX_KEY, index);
  setActiveProjectId(updated.id);
}

export function loadProject(id: string): SubtitleDocument | null {
  return read<SubtitleDocument>(PROJECT_KEY(id));
}

export function deleteProject(id: string): void {
  const store = storage();
  store?.removeItem(PROJECT_KEY(id));
  const index = listProjectSummaries().filter((p) => p.id !== id);
  if (store) store.setItem(INDEX_KEY, JSON.stringify(index));
  if (getActiveProjectId() === id) setActiveProjectId(null);
}

export function setActiveProjectId(id: string | null): void {
  const store = storage();
  if (!store) return;
  if (id === null) store.removeItem(ACTIVE_KEY);
  else store.setItem(ACTIVE_KEY, id);
}

export function getActiveProjectId(): string | null {
  const store = storage();
  return store?.getItem(ACTIVE_KEY) ?? null;
}

/**
 * Remove every key this app has written.
 * Only keys under our own namespace are touched, so unrelated site data is
 * left alone.
 */
export function clearAllSavedData(): number {
  const store = storage();
  if (!store) return 0;
  const doomed: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key && key.startsWith(`${NS}.`)) doomed.push(key);
  }
  doomed.forEach((key) => store.removeItem(key));
  return doomed.length;
}

export function storageUsageBytes(): number {
  const store = storage();
  if (!store) return 0;
  let total = 0;
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (!key || !key.startsWith(`${NS}.`)) continue;
    total += key.length + (store.getItem(key)?.length ?? 0);
  }
  // JS strings are UTF-16; two bytes per code unit is the right approximation.
  return total * 2;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

export function loadSettings(): AppSettings {
  const stored = read<Partial<AppSettings>>(SETTINGS_KEY);
  if (!stored || typeof stored !== "object") return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...stored };
}

export function saveSettings(settings: AppSettings): void {
  write(SETTINGS_KEY, settings);
}
