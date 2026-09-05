"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useProject } from "@/lib/project-context";
import { translationProgress } from "@/lib/types";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/translator/", label: "Translator" },
  { href: "/settings/", label: "Settings" },
];

export function Navbar() {
  const pathname = usePathname();
  const { doc, entries } = useProject();
  const progress = translationProgress(entries);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-lg"
          aria-label="Kurdish Sorani Subtitle Translator, home"
        >
          <span
            aria-hidden="true"
            className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-600 to-accent-600 text-sm font-bold text-white"
          >
            ک
          </span>
          <span className="hidden flex-col leading-tight sm:flex">
            <span className="text-sm font-semibold text-slate-900">
              Kurdish Sorani Subtitle Translator
            </span>
            <span className="text-xs text-slate-500">
              100% in your browser · no uploads
            </span>
          </span>
        </Link>

        <nav aria-label="Main" className="ml-auto flex items-center gap-1">
          {LINKS.map((link) => {
            const active =
              link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "rounded-lg bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700"
                    : "rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        {doc && progress.total > 0 && (
          <div
            className="hidden items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 md:flex"
            title={`${progress.translated} of ${progress.total} subtitles translated`}
          >
            <span className="text-xs font-medium text-slate-600">
              {progress.percent}%
            </span>
            <div
              className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200"
              role="progressbar"
              aria-valuenow={progress.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Translation progress"
            >
              <div
                className="h-full rounded-full bg-accent-500 transition-[width] duration-300"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
