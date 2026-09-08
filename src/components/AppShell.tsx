"use client";

import type { ReactNode } from "react";

import { ProjectProvider } from "@/lib/project-context";
import { NeuralProvider } from "@/lib/neural/context";
import { SettingsProvider } from "@/lib/settings-context";
import { ToastProvider } from "@/lib/toast-context";
import { Navbar } from "./Navbar";
import { ToastViewport } from "./ToastViewport";

/**
 * Client-side providers. Everything below this component is a client component,
 * which is exactly what a fully static, browser-only application needs.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <ToastProvider>
        <ProjectProvider>
          <NeuralProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-white"
          >
            Skip to main content
          </a>
          <Navbar />
          <main id="main" className="mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
            {children}
          </main>
          <ToastViewport />
          </NeuralProvider>
        </ProjectProvider>
      </ToastProvider>
    </SettingsProvider>
  );
}
