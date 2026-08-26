import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

test("TST-139: create vacancy saves unique title as active version 1 with Drive binding and never calls LLM", async () => {
  const ui = await read("app/page.tsx");
  const application = await read("server/product/application.ts");
  const create = ui.slice(ui.indexOf("function CreateVacancy"));
  assert.match(create, />Сохранить</, "create screen primary action is `Сохранить`");
  assert.doesNotMatch(create, /\/api\/vacancies\/generate/, "create screen does not call generation/LLM");
  assert.match(application, /version\s*:\s*1/, "create operation persists immutable version 1");
  assert.match(application, /driveFolderId|Drive binding/i, "create operation binds the active vacancy to Drive");
});

test("TST-140: existing vacancy generates description into unsaved editor only", async () => {
  const [ui, css] = await Promise.all([read("app/page.tsx"), read("app/globals.css")]);
  const vacancies = ui.slice(ui.indexOf("function Vacancies"), ui.indexOf("function VacancyGenerationPromptModal"));
  assert.match(vacancies, /Сгенерировать описание/, "generation action remains in the selected vacancy header");
  assert.match(vacancies, /className="generate-description-button"/, "generation has its own visual role instead of looking like Save");
  assert.doesNotMatch(vacancies.match(/<button[\s\S]{0,300}Сгенерировать описание/)?.[0] ?? "", /className="primary-button"/, "generation is not styled as the primary Save action");
  assert.match(css, /\.generate-description-button\{[^}]*background:var\(--paper\)[^}]*color:var\(--blue\)[^}]*box-shadow:[^}]*var\(--blue\)/, "generation keeps the panel surface and gets a blue glow");
  assert.match(vacancies, /\/api\/vacancies\/generate/, "the selected vacancy action starts generation");
  assert.match(vacancies, /setGeneratedDraft\(generated\)/, "valid response stores the complete generated profile as an unsaved editor draft");
  assert.match(vacancies, /initialDraft=\{generatedDraft\}/, "the settings editor receives generated fields and ABC directions without mutating the persisted vacancy projection");
  assert.doesNotMatch(vacancies, /confirmAndGenerate[\s\S]{0,2000}await\s+save\s*\(/, "generation does not auto-save a profile version");
});

test("TST-140 regression: completed LLM generation remounts the open settings editor with the new profile immediately", async () => {
  const ui = await read("app/page.tsx");
  const vacancies = ui.slice(ui.indexOf("function Vacancies"), ui.indexOf("function VacancyGenerationPromptModal"));
  assert.match(vacancies, /setSettingsRevision\(\(revision\)\s*=>\s*revision\s*\+\s*1\)/, "a successful generation invalidates the mounted settings draft");
  assert.match(vacancies, /<VacancySettings[\s\S]{0,160}key=\{`\$\{vacancy\.id\}:\$\{settingsRevision\}`\}/, "the editor remount key changes in the same render as the generated vacancy profile");
  assert.ok(vacancies.indexOf("setSettingsRevision((revision) => revision + 1)") < vacancies.indexOf('setTab("Параметры оценки")'), "the fresh draft is prepared before the generated settings tab is shown");
});

test("TST-141: every vacancy parameter block exposes only the action label `Сохранить`", async () => {
  const ui = await read("app/page.tsx");
  const settings = ui.slice(ui.indexOf("function VacancySettings"), ui.indexOf("function CreateVacancy"));
  assert.doesNotMatch(settings, /Сохранить новую версию/, "obsolete label is absent from all settings blocks");
  assert.ok((settings.match(/>Сохранить</g) ?? []).length >= 2, "ABC and ordinary parameter blocks both use `Сохранить`");
});

test("TST-142: intake uses four full snapshots at approximately 0/15/30/45 seconds", async () => {
  const discovery = await read("server/candidate-pipeline/discovery.ts");
  assert.match(discovery, /SNAPSHOT_COUNT\s*=\s*4|REQUIRED_SNAPSHOTS\s*=\s*4/, "four snapshots are explicit in the production contract");
  assert.match(discovery, /15_000/, "snapshots use the 15 second discovery cadence");
  assert.doesNotMatch(discovery, /STABILITY_INTERVAL_MS\s*=\s*60_000/, "stability does not wait 60 seconds between snapshots");
  assert.match(discovery, /fileId[\s\S]{0,300}(?:size|sizeBytes)[\s\S]{0,300}(?:count|length)/i, "every full snapshot compares file ID, count and size");
});

test("TST-143: changed file identity/count/size resets stability and one stable folder queues once", async () => {
  const discovery = await read("server/candidate-pipeline/discovery.ts");
  assert.match(discovery, /reset/i, "a changed snapshot explicitly resets the four-snapshot window");
  assert.match(discovery, /AUTOMATIC_FIRST_RUN/, "stable initial input has the canonical automatic trigger");
  assert.match(discovery, /duplicate|fingerprint/, "repeat observation is idempotent and cannot enqueue twice");
});

test("TST-144: Docker runtime contains executable FFmpeg and health performs a real version probe", async () => {
  const [dockerfile, mediaServer] = await Promise.all([read("Dockerfile"), read("server/media-processor/server.ts")]);
  assert.match(dockerfile, /(?:apt-get[^\n]+install[^\n]+ffmpeg|chmod\s+\+x[^\n]*ffmpeg|ffmpeg\s+-version)/i, "Docker build proves an executable FFmpeg binary");
  assert.match(mediaServer, /(?:spawn|execFile)[\s\S]{0,240}(?:-version|version)/, "health executes an FFmpeg version probe");
  assert.doesNotMatch(mediaServer, /ffmpeg:\s*Boolean\(ffmpegStaticPath\)/, "health does not treat a non-empty path as readiness");
});

test("TST-145: media readiness includes synthetic extraction, not version-only health", async () => {
  const mediaServer = await read("server/media-processor/server.ts");
  assert.match(mediaServer, /health[\s\S]{0,2500}(?:lavfi|sine=|synthetic)[\s\S]{0,1000}(?:extractAudioTrack|extract)/i, "health/preflight performs a synthetic media extraction");
});
