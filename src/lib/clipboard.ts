/**
 * Clipboard helpers.
 *
 * `navigator.clipboard` is the right API but it is only exposed in secure
 * contexts, and the app may be opened from `file://` after a static export. A
 * hidden-textarea fallback keeps copy/paste working in that case; if neither
 * path works the caller gets a thrown error it can surface as a message.
 */

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fall through to the legacy path
    }
  }

  const area = document.createElement("textarea");
  area.value = text;
  // Keep it out of the a11y tree and off-screen, but focusable.
  area.setAttribute("aria-hidden", "true");
  area.style.position = "fixed";
  area.style.top = "-1000px";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    const ok = document.execCommand("copy");
    if (!ok) throw new Error("Copy command was refused by the browser.");
  } finally {
    document.body.removeChild(area);
  }
}

export async function readText(): Promise<string> {
  if (navigator.clipboard?.readText) {
    try {
      return await navigator.clipboard.readText();
    } catch {
      throw new Error(
        "The browser blocked clipboard access. Use Ctrl/Cmd+V in the translation field instead.",
      );
    }
  }
  throw new Error(
    "This browser does not allow reading the clipboard. Use Ctrl/Cmd+V in the translation field instead.",
  );
}
