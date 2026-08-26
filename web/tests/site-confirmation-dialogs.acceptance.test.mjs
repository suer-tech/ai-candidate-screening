import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("all product confirmations use application dialogs instead of browser popups", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(
    source,
    /(?:window|globalThis)\.(?:confirm|alert|prompt)\s*\(/,
    "product flows must not open native browser confirmation, alert, or prompt windows",
  );
  assert.match(source, /Отключить Google Drive\?/);
  assert.match(source, /Запустить повторную обработку кандидата\?/);
  assert.match(source, /Запустить генерацию описания вакансии\?/);
  assert.match(source, /function ConfirmationDialog[\s\S]{0,1600}className="confirmation-modal panel"/,
    "confirmation flows must share the site's styled dialog component");
});
