"use client";

/**
 * Project state: the loaded document, undo/redo, and every mutation the
 * translator page needs.
 *
 * Design note: `entries` lives *only* in the undo/redo history, and the rest of
 * the document lives in `docMeta`. The document the UI sees is the two joined
 * together in a memo. That arrangement means undo/redo is just "move the
 * history cursor" — there is no second copy of the entry list to keep in sync,
 * and no state updates are performed inside another updater (which React may
 * invoke twice in StrictMode and which would double-push undo steps).
 *
 * Persistence is debounced to local storage; nothing ever leaves the browser.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { FormatId, SubtitleDocument, SubtitleEntry } from "./types";
import { createEntry, TARGET_LANGUAGE_CODE } from "./types";
import { msToSrt, parseTimeToMs } from "./time";
import { openSubtitleFile, type OpenResult } from "./formats";
import type { FormatInput } from "./formats/shared";
import { useHistory } from "./history";
import {
  getActiveProjectId,
  loadProject,
  saveProject,
  setActiveProjectId,
  StorageError,
} from "./storage";

export type ReplaceScope = "translation" | "original" | "both";

/** Everything about a document except the entry list. */
type DocMeta = Omit<SubtitleDocument, "entries">;

export interface ProjectContextValue {
  doc: SubtitleDocument | null;
  entries: SubtitleEntry[];
  warnings: string[];
  selection: Set<number>;
  isDirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  storageNotice: string | null;

  openFile: (fileName: string, input: FormatInput) => Promise<OpenResult>;
  loadSavedProject: (id: string) => boolean;
  closeProject: () => void;

  setSourceLanguage: (code: string) => void;
  setTranslation: (id: number, text: string) => void;
  setOriginal: (id: number, text: string) => void;
  setTimes: (id: number, start: string, end: string) => void;
  addEntry: (afterId?: number) => number | null;
  deleteEntries: (ids: number[]) => void;
  splitEntry: (id: number) => number | null;
  mergeWithNext: (id: number) => boolean;
  searchReplace: (find: string, replace: string, scope: ReplaceScope) => number;

  toggleSelect: (id: number) => void;
  selectAll: () => void;
  clearSelection: () => void;

  undo: () => void;
  redo: () => void;
  saveNow: () => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

function newProjectId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function metaFor(fileName: string, format: FormatId): DocMeta {
  return {
    id: newProjectId(),
    fileName,
    format,
    sourceLanguage: "auto",
    targetLanguage: TARGET_LANGUAGE_CODE,
    formatMeta: {},
    warnings: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    nextId: 1,
  };
}

/** Renumber indexes 1..n so numbering stays contiguous after add/delete/split. */
function withReindex(entries: SubtitleEntry[]): SubtitleEntry[] {
  return entries.map((entry, i) => ({ ...entry, index: i + 1 }));
}

function splitInHalf(text: string): [string, string] {
  const flat = text.replace(/\s*\n\s*/g, " ").trim();
  if (!flat) return ["", ""];
  const words = flat.split(/\s+/);
  if (words.length === 1) return [flat, ""];
  const cut = Math.max(1, Math.ceil(words.length / 2));
  return [words.slice(0, cut).join(" "), words.slice(cut).join(" ")];
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [docMeta, setDocMeta] = useState<DocMeta | null>(null);
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [isDirty, setDirty] = useState(false);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);

  const history = useHistory<SubtitleEntry[]>([]);
  const entries = history.state;

  // Latest values, readable from event handlers without stale closures.
  const metaRef = useRef<DocMeta | null>(null);
  metaRef.current = docMeta;
  const entriesRef = useRef<SubtitleEntry[]>(entries);
  entriesRef.current = entries;

  const doc = useMemo<SubtitleDocument | null>(
    () => (docMeta === null ? null : { ...docMeta, entries }),
    [docMeta, entries],
  );

  const persist = useCallback((candidate: SubtitleDocument) => {
    try {
      saveProject(candidate);
      setDirty(false);
      setStorageNotice(null);
    } catch (err) {
      setStorageNotice(
        err instanceof StorageError ? err.message : "Could not save to local storage.",
      );
    }
  }, []);

  /* ---------------------------------------------------------------- *
   * Loading
   * ---------------------------------------------------------------- */

  const openFile = useCallback(
    async (fileName: string, input: FormatInput): Promise<OpenResult> => {
      const result = openSubtitleFile(fileName, input);
      setDocMeta({
        ...metaFor(fileName, result.format),
        formatMeta: result.formatMeta,
        warnings: result.warnings,
        nextId: result.nextId,
      });
      history.reset(result.entries);
      setSelection(new Set());
      setDirty(true);
      return result;
    },
    [history],
  );

  const loadSavedProject = useCallback(
    (id: string): boolean => {
      const loaded = loadProject(id);
      if (!loaded) return false;
      const { entries: savedEntries, ...meta } = loaded;
      setDocMeta(meta);
      history.reset(savedEntries);
      setSelection(new Set());
      setDirty(false);
      setStorageNotice(null);
      return true;
    },
    [history],
  );

  const closeProject = useCallback(() => {
    setDocMeta(null);
    history.reset([]);
    setSelection(new Set());
    setActiveProjectId(null);
    setDirty(false);
  }, [history]);

  /* ---------------------------------------------------------------- *
   * Editing helpers
   * ---------------------------------------------------------------- */

  /** Apply a pure transform to the entry list, recording one undo step. */
  const commitEntries = useCallback(
    (transform: (prev: SubtitleEntry[]) => SubtitleEntry[], recordUndo = true) => {
      const next = withReindex(transform(entriesRef.current));
      if (recordUndo) history.set(next);
      else history.reset(next);
      setDocMeta((meta) => (meta ? { ...meta, updatedAt: Date.now() } : meta));
      setDirty(true);
      return next;
    },
    [history],
  );

  const patchEntry = useCallback(
    (id: number, patch: Partial<SubtitleEntry>, recordUndo = true) => {
      commitEntries(
        (prev) => prev.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
        recordUndo,
      );
    },
    [commitEntries],
  );

  /* ---------------------------------------------------------------- *
   * Editing actions
   * ---------------------------------------------------------------- */

  const setSourceLanguage = useCallback((code: string) => {
    setDocMeta((meta) => (meta ? { ...meta, sourceLanguage: code } : meta));
    setDirty(true);
  }, []);

  // Text edits fire per keystroke, so they replace the current state instead of
  // pushing a new undo step on every character.
  const setTranslation = useCallback(
    (id: number, text: string) => patchEntry(id, { translated_text: text }, false),
    [patchEntry],
  );

  const setOriginal = useCallback(
    (id: number, text: string) => patchEntry(id, { original_text: text }, false),
    [patchEntry],
  );

  const setTimes = useCallback(
    (id: number, start: string, end: string) => {
      try {
        parseTimeToMs(start);
        parseTimeToMs(end);
      } catch {
        return; // partial typing; the input shows its own validity state
      }
      patchEntry(id, { start_time: start, end_time: end });
    },
    [patchEntry],
  );

  const addEntry = useCallback(
    (afterId?: number): number | null => {
      const meta = metaRef.current;
      if (meta === null) return null;

      const list = entriesRef.current;
      const referenceIndex =
        afterId === undefined ? list.length - 1 : list.findIndex((e) => e.id === afterId);
      const reference = list[referenceIndex];
      const startMs = reference ? parseTimeToMs(reference.end_time) : 0;

      const created = createEntry(
        meta.nextId,
        0,
        msToSrt(startMs),
        msToSrt(startMs + 2000),
        "",
      );

      const insertAt = referenceIndex + 1;
      commitEntries((prev) => [...prev.slice(0, insertAt), created, ...prev.slice(insertAt)]);
      setDocMeta((m) => (m ? { ...m, nextId: m.nextId + 1 } : m));
      return created.id;
    },
    [commitEntries],
  );

  const deleteEntries = useCallback(
    (ids: number[]) => {
      if (ids.length === 0) return;
      const doomed = new Set(ids);
      commitEntries((prev) => prev.filter((entry) => !doomed.has(entry.id)));
      setSelection(new Set());
    },
    [commitEntries],
  );

  const splitEntry = useCallback(
    (id: number): number | null => {
      const meta = metaRef.current;
      if (meta === null) return null;

      const list = entriesRef.current;
      const index = list.findIndex((e) => e.id === id);
      if (index === -1) return null;

      const entry = list[index];
      const startMs = parseTimeToMs(entry.start_time);
      const endMs = parseTimeToMs(entry.end_time);
      const midMs = startMs + Math.round((endMs - startMs) / 2);

      const [leftOriginal, rightOriginal] = splitInHalf(entry.original_text);
      const [leftTranslated, rightTranslated] = splitInHalf(entry.translated_text);

      const right: SubtitleEntry = {
        ...createEntry(meta.nextId, 0, msToSrt(midMs), entry.end_time, rightOriginal),
        translated_text: rightTranslated,
        style: { ...entry.style },
        metadata: { ...entry.metadata },
      };

      commitEntries((prev) => [
        ...prev.slice(0, index),
        {
          ...entry,
          end_time: msToSrt(midMs),
          original_text: leftOriginal,
          translated_text: leftTranslated,
        },
        right,
        ...prev.slice(index + 2),
      ]);
      setDocMeta((m) => (m ? { ...m, nextId: m.nextId + 1 } : m));
      return right.id;
    },
    [commitEntries],
  );

  const mergeWithNext = useCallback(
    (id: number): boolean => {
      const list = entriesRef.current;
      const index = list.findIndex((e) => e.id === id);
      if (index === -1 || index === list.length - 1) return false;

      const current = list[index];
      const next = list[index + 1];
      const joined = (a: string, b: string) =>
        [a.trim(), b.trim()].filter(Boolean).join("\n");

      const merged: SubtitleEntry = {
        ...current,
        end_time: next.end_time,
        original_text: joined(current.original_text, next.original_text),
        translated_text: joined(current.translated_text, next.translated_text),
      };

      commitEntries((prev) => [
        ...prev.slice(0, index),
        merged,
        ...prev.slice(index + 2),
      ]);
      return true;
    },
    [commitEntries],
  );

  const searchReplace = useCallback(
    (find: string, replace: string, scope: ReplaceScope): number => {
      if (!find) return 0;
      const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(escaped, "g");
      let count = 0;

      const next = entriesRef.current.map((entry) => {
        let result = entry;
        if (scope === "translation" || scope === "both") {
          const updated = entry.translated_text.replace(pattern, replace);
          count += (entry.translated_text.match(pattern) ?? []).length;
          if (updated !== entry.translated_text) {
            result = { ...result, translated_text: updated };
          }
        }
        if (scope === "original" || scope === "both") {
          const updated = entry.original_text.replace(pattern, replace);
          count += (entry.original_text.match(pattern) ?? []).length;
          if (updated !== entry.original_text) {
            result = { ...result, original_text: updated };
          }
        }
        return result;
      });

      if (count === 0) return 0;
      commitEntries(() => next);
      return count;
    },
    [commitEntries],
  );

  /* ---------------------------------------------------------------- *
   * Selection
   * ---------------------------------------------------------------- */

  const toggleSelect = useCallback((id: number) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelection(new Set(entriesRef.current.map((e) => e.id)));
  }, []);

  const clearSelection = useCallback(() => setSelection(new Set()), []);

  /* ---------------------------------------------------------------- *
   * Persistence
   * ---------------------------------------------------------------- */

  const saveNow = useCallback(() => {
    const candidate = docMeta === null ? null : { ...docMeta, entries: entriesRef.current };
    if (candidate === null) return;
    persist(candidate);
  }, [docMeta, persist]);

  useEffect(() => {
    if (docMeta === null || !isDirty) return;
    const timer = setTimeout(() => {
      persist({ ...docMeta, entries: entriesRef.current });
    }, 600);
    return () => clearTimeout(timer);
  }, [docMeta, entries, isDirty, persist]);

  // Restore the most recently active project once, on first mount.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const activeId = getActiveProjectId();
    if (activeId) loadSavedProject(activeId);
  }, [loadSavedProject]);

  const value = useMemo<ProjectContextValue>(
    () => ({
      doc,
      entries,
      warnings: doc?.warnings ?? [],
      selection,
      isDirty,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      storageNotice,
      openFile,
      loadSavedProject,
      closeProject,
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
      undo: history.undo,
      redo: history.redo,
      saveNow,
    }),
    [
      doc,
      entries,
      selection,
      isDirty,
      history.canUndo,
      history.canRedo,
      history.undo,
      history.redo,
      storageNotice,
      openFile,
      loadSavedProject,
      closeProject,
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
      saveNow,
    ],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectContextValue {
  const context = useContext(ProjectContext);
  if (context === null) {
    throw new Error("useProject must be used inside <ProjectProvider>.");
  }
  return context;
}
