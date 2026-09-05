"use client";

import Link from "next/link";

import { Dropzone } from "@/components/Dropzone";
import { FORMAT_LIST } from "@/lib/formats";
import { useProject } from "@/lib/project-context";
import { translationProgress } from "@/lib/types";

const WORKFLOW = [
  {
    title: "Upload",
    body: "Drop in an SRT, ASS, VTT or any other supported file. It is parsed in your browser — never uploaded.",
  },
  {
    title: "Copy the original",
    body: "Each subtitle has a Copy button. Send the text to whatever translation tool you prefer.",
  },
  {
    title: "Paste the Sorani",
    body: "Use the Paste button, or just type directly into the right-hand field. Right-to-left editing is built in.",
  },
  {
    title: "Review and export",
    body: "Check timings in the preview, then export in the original format or any other — and download.",
  },
];

export default function HomePage() {
  const { doc, entries } = useProject();
  const progress = translationProgress(entries);

  return (
    <div className="py-10 sm:py-14">
      <section className="mx-auto max-w-3xl text-center">
        <span className="badge bg-accent-100 text-accent-800">
          Private by design · no server, no API keys
        </span>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          Kurdish Sorani{" "}
          <span className="bg-gradient-to-r from-brand-600 to-accent-600 bg-clip-text text-transparent">
            Subtitle Translator
          </span>
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-slate-600">
          Turn any subtitle file into Kurdish Sorani (کوردیی سۆرانی). Every step —
          parsing, editing, previewing and exporting — happens locally in your
          browser. You stay in control of the wording, because you supply the
          translation.
        </p>
      </section>

      <section className="mx-auto mt-10 max-w-2xl">
        <Dropzone />
      </section>

      {doc && (
        <section className="mx-auto mt-6 max-w-2xl">
          <div className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">{doc.fileName}</p>
              <p className="text-xs text-slate-500">
                {progress.translated} of {progress.total} translated · {progress.percent}%
              </p>
            </div>
            <Link href="/translator/" className="btn-primary">
              Start editing →
            </Link>
          </div>
        </section>
      )}

      <section className="mx-auto mt-14 max-w-5xl">
        <h2 className="text-center text-2xl font-semibold text-slate-900">
          How the manual workflow works
        </h2>
        <p className="mx-auto mt-2 max-w-2xl text-center text-slate-600">
          This app deliberately contains no translation engine. Machine output for
          Kurdish Sorani is unreliable, so the workflow is built around you copying
          text out and pasting a translation you are happy with back in.
        </p>

        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {WORKFLOW.map((item, i) => (
            <li key={item.title} className="card p-5">
              <span
                aria-hidden="true"
                className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white"
              >
                {i + 1}
              </span>
              <h3 className="mt-3 font-semibold text-slate-900">{item.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{item.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto mt-14 max-w-5xl">
        <h2 className="text-center text-2xl font-semibold text-slate-900">
          Supported subtitle formats
        </h2>
        <p className="mx-auto mt-2 max-w-2xl text-center text-slate-600">
          Each format has its own browser-based parser and exporter. The format is
          detected from the file contents, not just the extension, and styling is
          preserved wherever the format allows it.
        </p>

        <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FORMAT_LIST.map((descriptor) => (
            <li
              key={descriptor.id}
              className="card p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold text-slate-900">{descriptor.label}</h3>
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                  .{descriptor.extensions.join(" .")}
                </code>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                {descriptor.note}
              </p>
              {descriptor.charset !== "unicode" && (
                <p className="mt-2 text-xs font-medium text-amber-700">
                  ⚠ Cannot store Arabic script
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto mt-14 max-w-3xl">
        <div className="card bg-gradient-to-br from-brand-50 to-accent-50 p-6 text-center sm:p-8">
          <h2 className="text-xl font-semibold text-slate-900">Your files never leave this device</h2>
          <p className="mx-auto mt-2 max-w-xl text-slate-600">
            No uploads, no API keys, no third-party translation service, and no
            scraping of anyone&rsquo;s website. Work in progress is kept in your
            browser&rsquo;s local storage, and you can delete all of it at any time
            from Settings.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link href="/settings/" className="btn-secondary">
              Open Settings
            </Link>
            <Link href="/translator/" className="btn-primary">
              Open the translator
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
