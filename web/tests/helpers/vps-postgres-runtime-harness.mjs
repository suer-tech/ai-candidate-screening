import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { syntheticCredentialSentinels, syntheticPiiSentinels } from "../fixtures/vps-postgres-runtime/synthetic-matrix.mjs";

const webRoot = path.resolve(import.meta.dirname, "../..");
const repoRoot = path.resolve(webRoot, "..");
const conformancePath = path.join(webRoot, "server", "vps-postgres-runtime", "conformance.ts");

async function filesUnder(root) {
  const result = [];
  const visit = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) { if (!new Set(["tests", "node_modules", ".git", ".next", ".vinext", ".wrangler", ".runtime", "candidate"]).has(entry.name)) await visit(target); }
      else if (/\.(?:ts|tsx|js|mjs|json|jsonc)$/i.test(entry.name) && !/\.test\./i.test(entry.name)) result.push(target);
    }
  };
  try { await visit(root); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  return result;
}

async function productionSources() {
  const roots = ["app", "server", "db", "worker", "build"].map((value) => path.join(webRoot, value));
  const files = (await Promise.all(roots.map(filesUnder))).flat();
  for (const relative of ["package.json", "vite.config.ts", "cloudflare-env.d.ts", "wrangler.local.jsonc", ".openai/hosting.json"]) {
    const target = path.join(webRoot, relative);
    try { await access(target); files.push(target); } catch { /* optional legacy path is absent */ }
  }
  return [...new Set(files)];
}

async function scanForbiddenProductionGraph() {
  const patterns = [
    ["cloudflare:workers", /cloudflare:workers/i], ["D1", /\bD1Database\b|\bD1\b/], ["R2", /\bR2Bucket\b|\bR2\b/],
    ["Miniflare", /Miniflare/i], ["Wrangler", /Wrangler|wrangler/i], ["Sites", /sites-vite-plugin|\.openai[\\/]hosting\.json|@cloudflare\/vite-plugin/i],
  ];
  const violations = [];
  for (const file of await productionSources()) {
    const source = await readFile(file, "utf8");
    for (const [token, pattern] of patterns) if (pattern.test(source)) violations.push({ token, file: path.relative(repoRoot, file).replaceAll("\\", "/") });
  }
  return violations;
}

async function runProductionGraphScenario(fixture) {
  const violations = await scanForbiddenProductionGraph();
  const readiness = await readFile(path.join(webRoot, "server", "readiness", "e2e-preflight.ts"), "utf8");
  const expected = fixture.oracle.readinessChecks;
  const actualChecks = [...readiness.matchAll(/check\(["']([^"']+)["']/g)].map((match) => match[1]);
  return result(fixture, {
    status: violations.length === 0 && JSON.stringify(actualChecks) === JSON.stringify(expected) ? "SUCCEEDED" : "FAILED",
    safeCode: violations.length ? "CLOUDFLARE_PRODUCTION_DEPENDENCY_PRESENT" : "POSTGRES_READINESS_CONTRACT_MISSING",
    forbiddenProductionReferences: violations.length,
    readinessChecks: actualChecks,
    cloudflareReadyPath: /\b(?:d1|r2)\b/i.test(readiness),
    violationCategories: [...new Set(violations.map((item) => item.token))],
    violationFiles: [...new Set(violations.map((item) => item.file))].slice(0, 30),
  });
}

let adapterPromise;
async function adapter() {
  if (!adapterPromise) adapterPromise = (async () => {
    try { await access(conformancePath); } catch { return null; }
    const loaded = await import(`${pathToFileURL(conformancePath).href}?acceptance=${Date.now()}`);
    if (typeof loaded.runVpsPostgresRuntimeConformanceScenario !== "function") throw new TypeError("VPS PostgreSQL conformance module must export runVpsPostgresRuntimeConformanceScenario");
    return loaded;
  })();
  return adapterPromise;
}

async function runAdapterScenario(fixture) {
  const loaded = await adapter();
  if (!loaded) return result(fixture, { status: "NOT_IMPLEMENTED", safeCode: "VPS_POSTGRES_RUNTIME_CONFORMANCE_NOT_IMPLEMENTED" });
  const actual = await loaded.runVpsPostgresRuntimeConformanceScenario(structuredClone(fixture));
  return result(fixture, actual && typeof actual === "object" ? actual : { status: "FAILED", safeCode: "VPS_POSTGRES_CONFORMANCE_RESULT_INVALID" });
}

async function runNodeRuntimeScenario(fixture) {
  const packageJson = JSON.parse(await readFile(path.join(webRoot, "package.json"), "utf8"));
  const vite = await readFile(path.join(webRoot, "vite.config.ts"), "utf8");
  const buildScript = String(packageJson.scripts?.build ?? "");
  const startScript = String(packageJson.scripts?.start ?? "");
  const staticResult = {
    target: /nitro|node/i.test(vite + buildScript) && !/@cloudflare\/vite-plugin/i.test(vite) ? "node-nitro" : "cloudflare-or-unspecified",
    nodeEntrypointExists: /\.output[\\/]server[\\/]index\.mjs|nitro/i.test(startScript + vite),
    cloudflareBindingsUsed: /@cloudflare\/vite-plugin|cloudflare:workers|d1_databases|r2_buckets/i.test(vite),
  };
  const dynamic = await runAdapterScenario(fixture);
  return result(fixture, { ...dynamic, ...staticResult, status: dynamic.status === "SUCCEEDED" && staticResult.target === "node-nitro" && staticResult.nodeEntrypointExists && !staticResult.cloudflareBindingsUsed ? "SUCCEEDED" : "FAILED", safeCode: dynamic.safeCode ?? "NODE_NITRO_RUNTIME_NOT_READY" });
}

async function runConfigurationScenario(fixture) {
  const sources = await productionSources();
  const joined = (await Promise.all(sources.map((file) => readFile(file, "utf8")))).join("\n");
  const runtimeEnvCount = Number(/\.runtime[\\/]runtime\.env/.test(joined));
  const credentialDirectoryCount = Number(/\.runtime[\\/]credentials/.test(joined));
  const legacySettingsRejected = fixture.rejectedSettings.filter((name) => new RegExp(name).test(joined)).length;
  const dynamic = await runAdapterScenario(fixture);
  return result(fixture, {
    ...dynamic,
    status: dynamic.status === "SUCCEEDED" && runtimeEnvCount === 1 && credentialDirectoryCount === 1 && legacySettingsRejected === fixture.rejectedSettings.length ? "SUCCEEDED" : "FAILED",
    safeCode: dynamic.safeCode ?? "UNIFIED_CONFIGURATION_NOT_READY",
    runtimeEnvCount,
    credentialDirectoryCount,
    legacySettingsRejected,
  });
}

async function runBenchmarkScenario(fixture) {
  const benchmark = fixture.benchmark;
  const roles = benchmark.files.map((file) => file.role);
  const roleClassificationUnambiguous = roles.filter((role) => role === "reference-abc").length === 1 && roles.filter((role) => role === "reference-result").length === 1 && roles.includes("consent-proof") && roles.includes("pipeline-input");
  const requestChecksums = benchmark.providerRequests.flatMap((request) => request.checksums);
  const leaked = benchmark.denyChecksums.filter((checksum) => requestChecksums.includes(checksum));
  const aggregate = benchmark.simulatedAggregateResult;
  const threshold = benchmark.oracle;
  const hardOracleStatus = aggregate.recommendationExact && aggregate.requiredSectionRecall === threshold.requiredSectionRecall && aggregate.significantClaimEvidenceRecall === threshold.significantClaimEvidenceRecall && aggregate.criticalAnchorRecall >= threshold.criticalAnchorRecallMinimum && aggregate.abcGradeMatch >= threshold.abcGradeMatchMinimum && aggregate.gradeInversions === 0 && aggregate.inventedStopFactors <= threshold.inventedStopFactorsMaximum ? "GREEN" : "RED";
  const dynamic = await runAdapterScenario(fixture);
  const failClosedReferenceLeakCount = benchmark.denyChecksums.length || 1;
  return result(fixture, {
    ...dynamic,
    status: dynamic.status === "SUCCEEDED" ? "SUCCEEDED" : "NOT_IMPLEMENTED",
    safeCode: dynamic.safeCode ?? "PRIVATE_BENCHMARK_RUNTIME_NOT_IMPLEMENTED",
    consentCheckedBeforeInputRead: dynamic.consentCheckedBeforeInputRead ?? false,
    roleClassificationUnambiguous,
    referenceChecksumsReachedNetwork: leaked.length,
    referenceChecksumsReachedDriveSnapshot: dynamic.referenceChecksumsReachedDriveSnapshot ?? failClosedReferenceLeakCount,
    referenceChecksumsReachedBlobs: dynamic.referenceChecksumsReachedBlobs ?? failClosedReferenceLeakCount,
    offlineOracleOnly: true,
    hardOracleStatus,
    cleanupAttemptedAfterRed: dynamic.cleanupAttemptedAfterRed ?? false,
    cleanupComplete: dynamic.cleanupComplete ?? false,
    privateCandidateFolderReads: dynamic.privateCandidateFolderReads ?? 1,
  });
}

const REACT_DOUBLE = `
let slots=[];let cursor=0;
export const Fragment=Symbol.for("acceptance.fragment");
export function __setHooks(values){slots=structuredClone(values);cursor=0}
export function __beginRender(){cursor=0}
export function useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==="function"?initial():initial;return [slots[i],v=>{slots[i]=typeof v==="function"?v(slots[i]):v}]}
export function useEffect(){} export function useMemo(f){return f()} export function useRef(v){return {current:v}} export function useCallback(v){return v}
export function jsx(type,props,key){return {type,key:key??null,props:props??{}}} export const jsxs=jsx;
`;
const RELATIVE_IMPORT = /(?:from\s*|import\s*)["'](\.[^"']+)["']/g;
async function resolveModule(importer, specifier) {
  const base = path.resolve(path.dirname(importer), specifier);
  for (const candidate of [/\.tsx?$/i.test(base) ? base : `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    try { await access(candidate); return candidate; } catch { /* try the next supported source suffix */ }
  }
  throw new Error(`UI_TEST_DEPENDENCY_UNRESOLVED:${specifier}`);
}
async function compileGraph(sourcePath, sourceRoot, outputRoot, entry = false, visited = new Map()) {
  if (visited.has(sourcePath)) return visited.get(sourcePath);
  const output = path.join(outputRoot, path.relative(sourceRoot, sourcePath)).replace(/\.tsx?$/i, ".mjs");
  visited.set(sourcePath, output);
  let source = await readFile(sourcePath, "utf8");
  if (entry) source += "\nexport { Dashboard, Candidates };\n";
  const dependencies = [...source.matchAll(RELATIVE_IMPORT)].map((match) => match[1]);
  const rewrites = new Map();
  for (const specifier of dependencies) {
    const dependency = await resolveModule(sourcePath, specifier);
    const emitted = await compileGraph(dependency, sourceRoot, outputRoot, false, visited);
    let relative = path.relative(path.dirname(output), emitted).replaceAll("\\", "/");
    if (!relative.startsWith(".")) relative = `./${relative}`;
    rewrites.set(specifier, relative);
  }
  let emitted = ts.transpileModule(source, { fileName: sourcePath, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, isolatedModules: true } }).outputText;
  let react = path.relative(path.dirname(output), path.join(outputRoot, "react-double.mjs")).replaceAll("\\", "/");
  if (!react.startsWith(".")) react = `./${react}`;
  emitted = emitted.replaceAll('"react/jsx-runtime"', JSON.stringify(react)).replaceAll('"react"', JSON.stringify(react));
  for (const [specifier, relative] of rewrites) emitted = emitted.replaceAll(`"${specifier}"`, JSON.stringify(relative));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, emitted, "utf8");
  return output;
}
function materialize(node) {
  if (!node || typeof node !== "object" || typeof node.type !== "function") return node;
  return materialize(node.type(node.props ?? {}));
}
function children(node) { const rendered = materialize(node); if (!rendered || typeof rendered !== "object") return []; const value = rendered.props?.children; return Array.isArray(value) ? value.flat(Infinity) : value === undefined ? [] : [value]; }
function nodes(node) { const output=[]; const visit=(value)=>{ const rendered=materialize(value); if (!rendered || typeof rendered !== "object") return; output.push(rendered); for(const child of children(rendered)) visit(child); }; visit(node); return output; }
function textContent(node) { const rendered=materialize(node); if (rendered === null || rendered === undefined || typeof rendered === "boolean") return ""; if (typeof rendered !== "object") return String(rendered); return children(rendered).map(textContent).join(""); }
function progressObservation(tree, cardClass) {
  const card = nodes(tree).find((node) => String(node.props?.className ?? "").split(/\s+/).includes(cardClass));
  const bars = card ? nodes(card).filter((node) => node.props?.role === "progressbar") : [];
  const bar = bars[0];
  const text = card ? textContent(card) : "";
  return { count: bars.length, percent: bar?.props?.["aria-valuenow"], min: bar?.props?.["aria-valuemin"], max: bar?.props?.["aria-valuemax"], milestone: text.includes("Доказательства собраны") ? "Доказательства собраны" : undefined };
}
async function runProgressUiScenario(fixture) {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "vpspg-progress-ui-"));
  try {
    await writeFile(path.join(outputRoot, "react-double.mjs"), REACT_DOUBLE, "utf8");
    const entry = await compileGraph(path.join(webRoot, "app", "page.tsx"), path.join(webRoot, "app"), outputRoot, true);
    const [components, react] = await Promise.all([import(`${pathToFileURL(entry).href}?ui=${Date.now()}`), import(pathToFileURL(path.join(outputRoot, "react-double.mjs")).href)]);
    const snapshot = { period: 7, counts: { MATERIALS_INCOMPLETE: 0, TRANSCRIBING: 0, ANALYZING: 1, VALIDATING: 0, READY: 0, FAILED: 0 }, waitingForHuman: 0, archivedCandidates: 0, queue: [fixture.candidate], ready: [], recommendations: { "Не рекомендовать": 0, "Недостаточно данных": 0, "Рекомендовать с оговорками": 0, "Рекомендовать": 0 }, flow: [] };
    react.__setHooks([7, { period: 7, snapshot, error: "" }]); react.__beginRender();
    const dashboard = components.Dashboard({ driveConnection: null, countdown: 15, onConnectDrive() {}, onDisconnectDrive() {}, onOpen() {}, onNavigate() {}, onQueueFilter() {} });
    react.__setHooks(["ACTIVE", "ALL"]); react.__beginRender();
    const list = components.Candidates({ items: [fixture.candidate], vacancies: [{ id: fixture.candidate.vacancyId, title: fixture.candidate.vacancy }], onOpen() {}, dashboardFilter: null, onClearDashboardFilter() {} });
    const dashboardProgress = progressObservation(dashboard, "processing-card");
    const listProgress = progressObservation(list, "candidate-card");
    const source = await readFile(path.join(webRoot, "app", "page.tsx"), "utf8");
    return result(fixture, { status: dashboardProgress.count === 1 && listProgress.count === 1 ? "SUCCEEDED" : "FAILED", safeCode: "PROGRESS_UI_CONTRACT_MISSING", dashboardProgressBars: dashboardProgress.count, listProgressBars: listProgress.count, dashboardPercent: dashboardProgress.percent, listPercent: listProgress.percent, dashboardMilestone: dashboardProgress.milestone, listMilestone: listProgress.milestone, ariaMin: dashboardProgress.min, ariaMax: dashboardProgress.max, browserInferredProgress: /setInterval[^]{0,500}progress|progress[^]{0,500}Date\.now/i.test(source) });
  } finally { await rm(outputRoot, { recursive: true, force: true }); }
}

function result(fixture, value) {
  const evidence = { fixtureSetId: fixture.fixtureSetId, synthetic: true, containsRealPii: false, containsSecrets: false, providerExpense: false, privateCandidateFolderRead: false };
  const output = { scenarioId: fixture.scenarioId, ...value, evidence };
  const serialized = JSON.stringify(output);
  output.evidence.credentialSentinelLeaks = syntheticCredentialSentinels.filter((sentinel) => serialized.includes(sentinel)).length;
  output.evidence.piiSentinelLeaks = syntheticPiiSentinels.filter((sentinel) => serialized.includes(sentinel)).length;
  return output;
}

export async function runVpsPostgresAcceptanceScenario(fixture) {
  if (fixture.kind === "production-graph") return runProductionGraphScenario(fixture);
  if (fixture.kind === "node-nitro-runtime") return runNodeRuntimeScenario(fixture);
  if (fixture.kind === "configuration-allowlist") return runConfigurationScenario(fixture);
  if (fixture.kind === "private-benchmark") return runBenchmarkScenario(fixture);
  if (fixture.kind === "rendered-progress-ui") return runProgressUiScenario(fixture);
  return runAdapterScenario(fixture);
}

function readPath(value, dotted) { return dotted.split(".").reduce((current, key) => current?.[key], value); }
export function verifyVpsPostgresOracle(actual, oracle) {
  const failures = [];
  for (const [key, expected] of Object.entries(oracle)) {
    const observed = readPath(actual, key);
    if (JSON.stringify(observed) !== JSON.stringify(expected)) failures.push(`${key}: expected ${JSON.stringify(expected)}; actual=${JSON.stringify(observed)}`);
  }
  for (const [key, expected] of Object.entries({ "evidence.synthetic": true, "evidence.containsRealPii": false, "evidence.containsSecrets": false, "evidence.providerExpense": false, "evidence.privateCandidateFolderRead": false, "evidence.credentialSentinelLeaks": 0, "evidence.piiSentinelLeaks": 0 })) {
    const observed = readPath(actual, key); if (observed !== expected) failures.push(`${key}: expected ${JSON.stringify(expected)}; actual=${JSON.stringify(observed)}`);
  }
  if (actual.status === "NOT_IMPLEMENTED") failures.unshift(actual.safeCode ?? "PRODUCTION_CONFORMANCE_NOT_IMPLEMENTED");
  return failures;
}
