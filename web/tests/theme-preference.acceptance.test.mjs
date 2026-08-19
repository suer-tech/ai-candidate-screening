import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const preference = await readFile(new URL("../app/theme-preference.ts", import.meta.url), "utf8");

test("TST-103: root layout applies the resolved theme before body content", () => {
  assert.match(layout, /THEME_BOOTSTRAP_SCRIPT/);
  assert.match(layout, /<head>[\s\S]*dangerouslySetInnerHTML[\s\S]*<\/head>[\s\S]*<body>/);
  assert.match(layout, /suppressHydrationWarning/);
});

test("TST-103: client persists only an explicit toggle and follows system otherwise", () => {
  assert.match(page, /readStoredTheme/);
  assert.match(preference, /prefers-color-scheme:\s*dark/);
  assert.match(page, /addEventListener\("change"/);
  assert.match(page, /addEventListener\("storage"/);
  assert.match(page, /writeStoredTheme\(nextTheme\)/);
  assert.doesNotMatch(page, /useEffect\([^;]+localStorage\.setItem/s);
});

test("TST-103: toggle exposes accessible selected state and decorative icons", () => {
  assert.match(page, /type="button"[^>]*className="theme-toggle"/);
  assert.match(page, /aria-label="Тёмная тема"/);
  assert.match(page, /aria-pressed=\{theme === "dark"\}/);
  assert.match(page, /aria-hidden="true"/);
  assert.match(css, /\.theme-icon-light/);
  assert.match(css, /html\[data-theme="dark"\][^}]*\.theme-icon-dark/);
});
