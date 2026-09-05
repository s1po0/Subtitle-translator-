/**
 * Advanced Sub Station Alpha (`.ass`) and Sub Station Alpha (`.ssa`).
 *
 * These are the only supported formats with real styling, so preservation is
 * the priority: the `[Script Info]` and `[V4+ Styles]` / `[V4 Styles]` blocks
 * are kept verbatim in `formatMeta` and written back untouched. Only the
 * `[Events]` section is rebuilt, and it is rebuilt from each entry's own
 * Layer/Margins/Effect/Name so per-line styling survives too.
 *
 * Field order inside a `Dialogue:` line is taken from the section's `Format:`
 * line rather than hard-coded, which is what makes one parser cover both
 * variants and their many dialects.
 */

import type { SubtitleEntry } from "../types";
import type { SubtitleFormat } from "./types";
import {
  finalizeEntries,
  makeEntry,
  toText,
  applyLineBreakPreference,
  exportText,
} from "./shared";
import { extractAssTags } from "../sanitize";

/** ASS/SSA clock: `H:MM:SS.cc` (centiseconds). */
const ASS_TIME_RE = /^(\d{1,2}):([0-5]\d):([0-5]\d)[.]([0-9]{1,2})$/;

export function parseAssTime(value: string): number {
  const match = ASS_TIME_RE.exec(value.trim());
  if (!match) throw new Error(`Invalid ASS timestamp: "${value}"`);
  const [, h, m, s, cs] = match;
  return (
    (Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000 + Number(cs) * 10
  );
}

export function formatAssTime(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const centis = Math.floor((safe % 1000) / 10);
  const totalSeconds = Math.floor(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(centis)}`;
}

interface Section {
  name: string;
  lines: string[];
}

function splitSections(text: string): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const rawLine of text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    const line = rawLine.replace(/^\ufeff/, "");
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header) {
      current = { name: (header[1] ?? "").trim(), lines: [] };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return sections;
}

/** Split a `Dialogue:` body honouring that `Text` is last and may hold commas. */
function splitFields(formatLine: string | undefined, body: string): Record<string, string> {
  const fields = (formatLine ?? "")
    .split(",")
    .map((f) => f.trim().toLowerCase());

  if (fields.length === 0) {
    // Fallback to the canonical V4+ order.
    fields.push(
      ...["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"],
    );
  }

  const values = body.split(",");
  const out: Record<string, string> = {};
  const lastIndex = fields.length - 1;
  fields.forEach((field, i) => {
    out[field] =
      i === lastIndex ? values.slice(i).join(",").trim() : (values[i] ?? "").trim();
  });
  return out;
}

function build(variant: "ass" | "ssa"): SubtitleFormat {
  return {
    id: variant,
    label: variant === "ass" ? "Advanced Sub Station Alpha" : "Sub Station Alpha",
    extensions: [variant],
    binary: false,
    supportsMarkup: true,
    supportsStyles: true,

    sniff(text: string): number {
      const lower = text.toLowerCase();
      if (lower.includes("[v4+ styles]")) return 1;
      if (lower.includes("[v4 styles]")) return 0.95;
      if (lower.includes("[script info]") && lower.includes("[events]")) return 0.95;
      return 0;
    },

    parse(input) {
      const { text } = toText(input);
      const sections = splitSections(text);
      const warnings: string[] = [];
      const partial: Array<Omit<SubtitleEntry, "id" | "index">> = [];

      let scriptInfo = "";
      let stylesBlock = "";
      let eventsFormat: string | undefined;
      let sawEvents = false;

      for (const section of sections) {
        const name = section.name.toLowerCase();

        if (name === "script info") {
          scriptInfo = `[Script Info]\n${section.lines.join("\n")}`.trim();
          continue;
        }
        if (name === "v4+ styles" || name === "v4 styles") {
          stylesBlock = `[${section.name}]\n${section.lines.join("\n")}`.trim();
          continue;
        }
        if (name === "fonts" || name === "graphics" || name === "aegisub extradata") {
          // Retain verbatim so export does not silently destroy them.
          stylesBlock = `${stylesBlock}\n\n[${section.name}]\n${section.lines.join("\n")}`.trim();
          continue;
        }
        if (name !== "events") continue;

        sawEvents = true;
        for (const line of section.lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith("!")) continue;

          const formatMatch = /^Format\s*:\s*(.*)$/i.exec(trimmed);
          if (formatMatch) {
            eventsFormat = formatMatch[1];
            continue;
          }

          const dialogue = /^(Dialogue|Comment)\s*:\s*(.*)$/i.exec(trimmed);
          if (!dialogue) {
            warnings.push(`Ignored unrecognised [Events] line: ${trimmed.slice(0, 60)}`);
            continue;
          }

          const isComment = (dialogue[1] ?? "").toLowerCase() === "comment";
          const fields = splitFields(eventsFormat, dialogue[2] ?? "");

          const startMs = safeAssTime(fields.start);
          const endMs = safeAssTime(fields.end);
          if (startMs === null || endMs === null) {
            warnings.push(`Skipped event with unreadable timing: ${trimmed.slice(0, 60)}`);
            continue;
          }

          const rawText = fields.text ?? "";
          const inlineTags = extractAssTags(rawText);
          // `\N` is a hard break, `\n` a soft one; both become a real newline.
          const normalised = rawText.replace(/\\N/g, "\n").replace(/\\n/g, "\n");

          partial.push(
            makeEntry(
              startMs,
              endMs,
              normalised,
              {
                name: fields.style || undefined,
                speaker: fields.name || undefined,
                layer: fields.layer ? Number(fields.layer) : undefined,
                marginL: fields.marginl,
                marginR: fields.marginr,
                marginV: fields.marginv,
                effect: fields.effect || undefined,
                ...(inlineTags.length ? { inlineTags } : {}),
              },
              {
                ...(isComment ? { comment: true } : {}),
                ...(rawText.includes("\\n") && !rawText.includes("\\N")
                  ? { lineBreakToken: "\\n" }
                  : {}),
                rawDialogue: trimmed,
              },
            ),
          );
        }
      }

      if (!sawEvents) {
        throw new Error("This file has no [Events] section, so it is not a usable ASS/SSA file.");
      }

      const { entries, nextId } = finalizeEntries(partial);
      if (entries.length === 0) throw new Error("No dialogue events could be parsed.");

      if (!stylesBlock) {
        warnings.push(
          "No styles section was found; exported files will use player defaults.",
        );
      }

      return {
        format: variant,
        entries,
        formatMeta: {
          scriptInfo: scriptInfo || `[Script Info]\nScriptType: ${variant === "ass" ? "v4.00+" : "v4.00"}`,
          stylesBlock,
          eventsFormat: eventsFormat ?? "",
        },
        warnings,
        nextId,
      };
    },

    serialize(doc, options) {
      const lineBreak = options?.lineBreakPreference ?? "original";
      const scriptInfo =
        doc.formatMeta.scriptInfo ??
        `[Script Info]\nScriptType: ${variant === "ass" ? "v4.00+" : "v4.00"}`;
      const stylesBlock = doc.formatMeta.stylesBlock ?? "";
      const formatLine =
        (doc.formatMeta.eventsFormat as string | undefined) ||
        "Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text";

      const out: string[] = [scriptInfo.trim(), ""];
      if (stylesBlock) out.push(stylesBlock.trim(), "");
      out.push("[Events]");
      out.push(`Format: ${formatLine}`);

      for (const entry of doc.entries) {
        const text = applyLineBreakPreference(exportText(entry), lineBreak);
        // Back to ASS line-break tokens.
        const breakToken = entry.metadata.lineBreakToken === "\\n" ? "\\n" : "\\N";
        const encoded = text.replace(/\n/g, breakToken);

        const layer = entry.style.layer ?? 0;
        const style = entry.style.name ?? "Default";
        const name = entry.style.speaker ?? "";
        const ml = entry.style.marginL ?? "0";
        const mr = entry.style.marginR ?? "0";
        const mv = entry.style.marginV ?? "0";
        const effect = entry.style.effect ?? "";
        const kind = entry.metadata.comment ? "Comment" : "Dialogue";

        out.push(
          `${kind}: ${layer},${formatAssTime(canonicalToMs(entry.start_time))},` +
            `${formatAssTime(canonicalToMs(entry.end_time))},${style},${name},` +
            `${ml},${mr},${mv},${effect},${encoded}`,
        );
      }

      return out.join("\n").replace(/\n+$/, "") + "\n";
    },
  };
}

function safeAssTime(value: string | undefined): number | null {
  if (!value) return null;
  try {
    return parseAssTime(value);
  } catch {
    return null;
  }
}

function canonicalToMs(value: string): number {
  // Entries store canonical SRT timestamps; ASS needs its own clock.
  const match = /^(\d{1,3}):([0-5]\d):([0-5]\d)[,.](\d{1,3})$/.exec(value.trim());
  if (!match) throw new Error(`Invalid timestamp: "${value}"`);
  const [, h, m, s, ms] = match;
  return (Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000 + Number(ms);
}

export const assFormat = build("ass");
export const ssaFormat = build("ssa");

/** Header name used by the styles section of each variant. */
export function stylesHeaderFor(format: "ass" | "ssa"): string {
  return format === "ass" ? "[V4+ Styles]" : "[V4 Styles]";
}
