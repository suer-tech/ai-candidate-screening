export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "hrconnect-theme";
export const DARK_THEME_QUERY = "(prefers-color-scheme: dark)";

export function parseTheme(value: unknown): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}

export function resolveTheme(storedValue: unknown, systemDark: boolean): Theme {
  return parseTheme(storedValue) ?? (systemDark ? "dark" : "light");
}

export function readStoredTheme(): Theme | null {
  try {
    return typeof window === "undefined" ? null : parseTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeStoredTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Restricted storage must not make the theme control unusable.
  }
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export const THEME_BOOTSTRAP_SCRIPT = `(() => {
  let stored = null;
  let systemDark = false;
  try { stored = window.localStorage.getItem("${THEME_STORAGE_KEY}"); } catch {}
  try { systemDark = window.matchMedia("${DARK_THEME_QUERY}").matches; } catch {}
  const theme = stored === "light" || stored === "dark" ? stored : (systemDark ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();`;
