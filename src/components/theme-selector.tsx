import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

export type ThemeChoice = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "keystone-beat-theme";

function isThemeChoice(value: string | null): value is ThemeChoice {
  return value === "light" || value === "dark" || value === "system";
}

function resolvedTheme(choice: ThemeChoice) {
  if (choice !== "system") return choice;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(choice: ThemeChoice) {
  const theme = resolvedTheme(choice);
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themeChoice = choice;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content",
    theme === "dark" ? "#0a0e16" : "#f4f7fa",
  );
}

const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

export function ThemeSelector() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    let initial: ThemeChoice = "system";
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (isThemeChoice(stored)) initial = stored;
    } catch {
      // Storage can be unavailable in hardened browsing modes; the theme still works for this visit.
    }
    setChoice(initial);
    applyTheme(initial);
  }, []);

  useEffect(() => {
    if (choice !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [choice]);

  function selectTheme(next: ThemeChoice) {
    setChoice(next);
    applyTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Keep the in-page choice working even when storage is unavailable.
    }
  }

  return (
    <fieldset
      className="flex shrink-0 items-center rounded-md border border-border bg-surface p-0.5 shadow-[var(--shadow-border)]"
      aria-label="Color theme"
    >
      <legend className="sr-only">Color theme</legend>
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = choice === value;
        return (
          <button
            key={value}
            type="button"
            title={`${label} theme`}
            aria-label={`${label} theme`}
            aria-pressed={active}
            onClick={() => selectTheme(value)}
            className={active
              ? "flex h-9 w-8 items-center justify-center rounded-sm bg-elevated text-fg sm:w-auto sm:gap-1.5 sm:px-2.5"
              : "flex h-9 w-8 items-center justify-center rounded-sm text-muted hover:bg-elevated hover:text-fg sm:w-auto sm:gap-1.5 sm:px-2.5"}
          >
            <Icon className="h-4 w-4" aria-hidden />
            <span className="hidden text-xs font-semibold lg:inline">{label}</span>
          </button>
        );
      })}
    </fieldset>
  );
}
