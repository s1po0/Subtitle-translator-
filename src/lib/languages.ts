/**
 * Source-language list and script direction detection.
 *
 * The target is always Kurdish Sorani (`ckb`, Arabic script, RTL). The source
 * is chosen by the user; it is carried on the document for the user's own
 * reference and to pick a sensible editor text direction.
 */

export interface LanguageOption {
  code: string;
  name: string;
  /** Kurdish Sorani name, shown alongside the English one. */
  nativeName: string;
  /** Writing direction of the language. */
  direction: "ltr" | "rtl";
}

export const SOURCE_LANGUAGES: LanguageOption[] = [
  { code: "auto", name: "Auto-detect", nativeName: "خۆکار", direction: "ltr" },
  { code: "en", name: "English", nativeName: "ئینگلیزی", direction: "ltr" },
  { code: "ar", name: "Arabic", nativeName: "عەرەبی", direction: "rtl" },
  { code: "ku", name: "Kurdish (Kurmanji)", nativeName: "کوردی (کرمانجی)", direction: "ltr" },
  { code: "fa", name: "Persian", nativeName: "فارسی", direction: "rtl" },
  { code: "tr", name: "Turkish", nativeName: "تورکی", direction: "ltr" },
  { code: "de", name: "German", nativeName: "ئەڵمانی", direction: "ltr" },
  { code: "fr", name: "French", nativeName: "فەڕەنسی", direction: "ltr" },
  { code: "es", name: "Spanish", nativeName: "ئیسپانی", direction: "ltr" },
  { code: "it", name: "Italian", nativeName: "ئیتاڵی", direction: "ltr" },
  { code: "pt", name: "Portuguese", nativeName: "پورتوگالی", direction: "ltr" },
  { code: "ru", name: "Russian", nativeName: "ڕووسی", direction: "ltr" },
  { code: "uk", name: "Ukrainian", nativeName: "ئۆکرانی", direction: "ltr" },
  { code: "zh", name: "Chinese", nativeName: "چینی", direction: "ltr" },
  { code: "ja", name: "Japanese", nativeName: "یاپۆنی", direction: "ltr" },
  { code: "ko", name: "Korean", nativeName: "کۆری", direction: "ltr" },
  { code: "hi", name: "Hindi", nativeName: "هیندی", direction: "ltr" },
  { code: "ur", name: "Urdu", nativeName: "ئوردو", direction: "rtl" },
  { code: "he", name: "Hebrew", nativeName: "عیبری", direction: "rtl" },
];

export function findLanguage(code: string): LanguageOption {
  return (
    SOURCE_LANGUAGES.find((l) => l.code === code) ??
    SOURCE_LANGUAGES.find((l) => l.code === "auto")!
  );
}

/** Arabic script blocks, covering Arabic, Kurdish, Persian and Urdu. */
const ARABIC_SCRIPT =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

const LATIN_SCRIPT = /[A-Za-z\u00C0-\u024F]/;

/**
 * Guess the dominant direction of a string by counting script ranges.
 * Punctuation and digits are neutral and ignored, which is what makes mixed
 * strings like `"OK — باشە"` resolve correctly.
 */
export function detectDirection(text: string): "ltr" | "rtl" {
  let rtl = 0;
  let ltr = 0;
  for (const ch of text) {
    if (ARABIC_SCRIPT.test(ch)) rtl += 1;
    else if (LATIN_SCRIPT.test(ch)) ltr += 1;
  }
  return rtl > ltr ? "rtl" : "ltr";
}

/** Resolve an editor's direction given a user preference and the text itself. */
export function resolveDirection(
  preference: "auto" | "ltr" | "rtl",
  text: string,
): "ltr" | "rtl" {
  if (preference !== "auto") return preference;
  return detectDirection(text);
}
