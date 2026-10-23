import React, { useEffect } from "react";
import { resolveTheme, type Theme } from "@/lib/review/prefs";

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

// Applies the theme to <html data-theme> and follows the system setting
// while "system" is selected.
export function useAppliedTheme(theme: Theme) {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(theme, media.matches);
    };
    apply();
    if (theme !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
}

export default function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
  return (
    <div role="group" aria-label="Appearance" className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
      {THEMES.map((t) => (
        <button
          key={t.value}
          type="button"
          aria-pressed={theme === t.value}
          data-theme-option={t.value}
          onClick={() => onChange(t.value)}
          className="rounded-md px-2.5 py-1 text-[12.5px] text-muted focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none aria-pressed:bg-surface aria-pressed:font-medium aria-pressed:text-fg aria-pressed:shadow-sm dark:aria-pressed:bg-surface-3"
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
