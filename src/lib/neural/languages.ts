/**
 * Mapping from this app's language codes to NLLB-200 language identifiers.
 *
 * NLLB addresses languages by BCP-47-ish codes with a script suffix
 * (`eng_Latn`, `ckb_Arab`, ...). Getting these wrong silently produces output
 * in the wrong language or script, so the mapping is explicit and total over
 * the languages the app offers, rather than guessed at call time.
 *
 * The target is always `ckb_Arab` — Central Kurdish in Arabic script, which is
 * Kurdish Sorani.
 */

export const NLLB_TARGET = "ckb_Arab";
export const NLLB_TARGET_LABEL = "Kurdish Sorani (کوردیی سۆرانی)";

/** App code -> NLLB code. `auto` is intentionally absent. */
const SOURCE_MAP: Readonly<Record<string, string>> = {
  en: "eng_Latn",
  ar: "arb_Arab",
  ku: "kmr_Latn", // Northern Kurdish / Kurmanji, Latin script
  fa: "pes_Arab", // Western Persian
  tr: "tur_Latn",
  de: "deu_Latn",
  fr: "fra_Latn",
  es: "spa_Latn",
  it: "ita_Latn",
  pt: "por_Latn",
  ru: "rus_Cyrl",
  uk: "ukr_Cyrl",
  zh: "zho_Hans",
  ja: "jpn_Jpan",
  ko: "kor_Hang",
  hi: "hin_Deva",
  ur: "urd_Arab",
  he: "heb_Hebr",
};

/**
 * Resolve a source code to its NLLB identifier.
 * Returns null for `auto` and for anything unmapped: NLLB cannot auto-detect,
 * so the caller must ask the user to choose a concrete source language.
 */
export function toNllbSource(code: string | undefined | null): string | null {
  if (!code) return null;
  const key = code.trim().toLowerCase();
  if (key === "auto") return null;
  return SOURCE_MAP[key] ?? null;
}

/** True when a concrete source language has been chosen and is supported. */
export function canNeuralTranslate(sourceCode: string | undefined | null): boolean {
  return toNllbSource(sourceCode) !== null;
}

/** Human-readable explanation of why neural drafting is unavailable. */
export function sourceLanguageProblem(code: string | undefined | null): string | null {
  if (!code || code === "auto") {
    return (
      "The neural engine cannot detect the source language automatically. " +
      "Choose a specific source language above to enable drafting."
    );
  }
  if (!SOURCE_MAP[code.trim().toLowerCase()]) {
    return `Source language "${code}" is not supported by the neural engine.`;
  }
  return null;
}

/** Codes the neural engine can translate from, for UI hints. */
export function supportedSourceCodes(): string[] {
  return Object.keys(SOURCE_MAP).sort();
}
