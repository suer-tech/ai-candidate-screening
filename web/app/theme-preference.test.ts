import assert from "node:assert/strict";
import test from "node:test";
import { THEME_BOOTSTRAP_SCRIPT, parseTheme, resolveTheme } from "./theme-preference";

type RootState = { dataset: Record<string, string>; style: Record<string, string> };

function runBootstrap(options: { stored?: string | null; systemDark?: boolean; storageError?: boolean }) {
  const root: RootState = { dataset: {}, style: {} };
  let writes = 0;
  const storage = {
    getItem() {
      if (options.storageError) throw new Error("storage unavailable");
      return options.stored ?? null;
    },
    setItem() { writes += 1; },
  };
  const browser = {
    localStorage: storage,
    matchMedia: () => ({ matches: options.systemDark ?? false }),
  };
  const document = { documentElement: root };
  Function("window", "document", THEME_BOOTSTRAP_SCRIPT)(browser, document);
  return { root, writes };
}

test("valid explicit preference wins over the system", () => {
  assert.equal(parseTheme("dark"), "dark");
  assert.equal(parseTheme("light"), "light");
  assert.equal(parseTheme("sepia"), null);
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
});

test("system preference is used only without a valid explicit preference", () => {
  assert.equal(resolveTheme(null, true), "dark");
  assert.equal(resolveTheme("invalid", false), "light");
});

test("bootstrap applies stored dark before content and does not persist fallback", () => {
  const explicit = runBootstrap({ stored: "dark", systemDark: false });
  assert.deepEqual(explicit.root.dataset, { theme: "dark" });
  assert.equal(explicit.root.style.colorScheme, "dark");
  assert.equal(explicit.writes, 0);

  const fallback = runBootstrap({ stored: null, systemDark: true });
  assert.deepEqual(fallback.root.dataset, { theme: "dark" });
  assert.equal(fallback.writes, 0);
});

test("bootstrap keeps rendering when storage access fails", () => {
  const result = runBootstrap({ storageError: true, systemDark: true });
  assert.equal(result.root.dataset.theme, "dark");
  assert.equal(result.root.style.colorScheme, "dark");
});
