import type { ReactNode } from "react";

/**
 * The frame of the SaaS edition's own pages (/welcome, /account, /disabled, /terms, /privacy; spec
 * 2026-10-21-saas-edition-design §8): the same navy top bar and column as the main screen, no data of its own.
 */
export default function SaasPageShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="app saas-page">
      <header className="topbar">
        <div className="brand">
          <img src="/icon.svg" width={34} height={34} alt="" />
          <div className="brand-name">
            <strong>Instructor Assistant</strong>
            <small>CBT&amp;A Lesson Checklist</small>
          </div>
        </div>
        <div className="headline">
          <h1>{title}</h1>
        </div>
      </header>
      {children}
    </main>
  );
}
