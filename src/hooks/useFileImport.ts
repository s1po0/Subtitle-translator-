"use client";

/**
 * Turns a `File` from the picker or a drop event into an open project.
 *
 * The file is read as an `ArrayBuffer` and handed straight to the parser — it
 * is never sent anywhere. Size and content validation happen in the registry
 * before any parsing work is attempted.
 */

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { useProject } from "@/lib/project-context";
import { useToast } from "@/lib/toast-context";
import { MAX_FILE_BYTES, FORMATS } from "@/lib/formats";

export function useFileImport() {
  const router = useRouter();
  const { openFile } = useProject();
  const { notify } = useToast();
  const [isImporting, setImporting] = useState(false);

  const importFile = useCallback(
    async (file: File, options?: { navigate?: boolean }) => {
      const navigate = options?.navigate ?? true;
      setImporting(true);
      notify("info", `Reading ${file.name}…`);

      try {
        if (file.size > MAX_FILE_BYTES) {
          notify(
            "error",
            "File too large",
            `${(file.size / (1024 * 1024)).toFixed(1)} MB exceeds the 100 MB limit.`,
          );
          return false;
        }

        const buffer = await file.arrayBuffer();
        const result = await openFile(file.name, new Uint8Array(buffer));

        const format = FORMATS[result.format];
        notify(
          "success",
          `${result.entries.length} subtitle${result.entries.length === 1 ? "" : "s"} loaded`,
          `Detected as ${format.label}.`,
        );

        result.warnings.slice(0, 3).forEach((warning) => {
          notify("warning", "Format note", warning);
        });

        if (navigate) router.push("/translator/");
        return true;
      } catch (err) {
        notify(
          "error",
          "Could not open that file",
          err instanceof Error ? err.message : "The file could not be read.",
        );
        return false;
      } finally {
        setImporting(false);
      }
    },
    [notify, openFile, router],
  );

  return { importFile, isImporting };
}
