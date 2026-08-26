import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { InMemoryVacancyGenerationRepository, generateVacancyProfile } from "../server/product/vacancy-generation.ts";
import { RouterAiVacancyProfileProvider } from "../server/product/vacancy-provider.ts";

type Role = "pipeline-input" | "reference-abc" | "reference-result" | "excluded";
type Entry = { path: string; role: Role; checksum: string; byteSize: number; mime: string };
type ProfileDraft = {
  schemaVersion: string;
  title: string;
  sourceOperationId: string;
  generatedAtUtc: string;
  profileSnapshotHash: string;
  generatedProfile: {
    schemaVersion: string;
    profile: Record<string, string>;
    abcDirections: Array<{ id: string; name: string; gradeA: string; gradeB: string; gradeC: string; origin: "standard" | "custom" }>;
    templateVersion: string;
    hrDecisionMarkers: string[];
  };
};
type ProfileApproval = {
  schemaVersion: string;
  profileDraftChecksum: string;
  title: string;
  profileSnapshotHash: string;
  approvedAtUtc: string;
  approvedBy: string;
};

const repoRoot = path.resolve(import.meta.dirname, "../..");
const candidateRoot = path.join(repoRoot, "candidate");
const privateRoot = path.join(candidateRoot, ".benchmark-private");
const manifestPath = path.join(privateRoot, "benchmark.manifest.local.json");
const oraclePath = path.join(privateRoot, "oracle.v1.local.json");
const profileDraftPath = path.join(privateRoot, "vacancy-profile.draft.local.json");
const profileApprovalPath = path.join(privateRoot, "vacancy-profile.approval.local.json");
const consentPath = path.join(privateRoot, "consent-proof.local.json");

function checksum(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }
function normalized(value: string) { return value.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9%+.-]+/gi, " ").trim(); }
function mime(bytes: Uint8Array) {
  const head = Buffer.from(bytes.subarray(0, 16));
  if (head.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (head.subarray(4, 8).toString() === "ftyp") return "video/mp4";
  const first = head.toString("utf8").trimStart()[0];
  if (first === "{" || first === "[") return "application/json";
  return "text/plain";
}
function classify(file: string): Role {
  const name = path.basename(file, path.extname(file)).toLowerCase();
  const extension = path.extname(file).toLowerCase();
  if (extension === ".pdf" && /abc|авс|профил/.test(name)) return "reference-abc";
  if (extension === ".pdf" && /result|итог|отчет|отчёт|результ/.test(name)) return "reference-result";
  if (extension === ".pdf" || extension === ".08") return "pipeline-input";
  return "excluded";
}
async function files(root: string): Promise<string[]> {
  const output: string[] = [];
  for (const item of await readdir(root, { withFileTypes: true })) {
    if (item.name === ".benchmark-private") continue;
    const target = path.join(root, item.name);
    if (item.isDirectory()) output.push(...await files(target));
    else if (item.isFile()) output.push(target);
  }
  return output.sort();
}
async function pdfText(file: string) {
  const document = await getDocument({ data: new Uint8Array(await readFile(file)), useWorkerFetch: false }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const content = await (await document.getPage(pageNumber)).getTextContent();
    pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
  }
  return pages.join("\n");
}
function recommendation(text: string) {
  const source = normalized(text).slice(0, 12_000);
  if (/не рекомендуется к найму|не рекомендовать/.test(source)) return "Не рекомендовать";
  if (/рекомендовать с оговорками/.test(source)) return "Рекомендовать с оговорками";
  if (/недостаточно данных/.test(source)) return "Недостаточно данных";
  if (/рекомендуется к найму|рекомендовать/.test(source)) return "Рекомендовать";
  return "human-review-required";
}
function directions(text: string) {
  const source = text.replace(/\s+/g, " ");
  const matches = [...source.matchAll(/([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё /]{2,80}?)\s*[–—-]\s*([ABCАВС])(?=\s|$)/g)];
  const unique = new Map<string, { title: string; grade: "A" | "B" | "C" }>();
  for (const match of matches) {
    const title = normalized(match[1]).slice(-80).trim();
    const raw = match[2].replace("А", "A").replace("В", "B").replace("С", "C") as "A" | "B" | "C";
    if (title.length >= 8 && !unique.has(title)) unique.set(title, { title, grade: raw });
  }
  return [...unique.values()].slice(0, 20);
}
function anchors(text: string) {
  return [...new Set(text.split(/[.!?\n]+/).map(normalized).filter((value) => value.length >= 45 && value.length <= 320))].slice(0, 40).map((value, index) => ({ id: `anchor-${String(index + 1).padStart(2, "0")}`, normalizedText: value,
    category: /риск|противореч|не подтверд|недостат|сомнен|ошиб|конфликт/.test(value) ? "risk-or-contradiction" : "critical-fact" }));
}

const args = process.argv.slice(2);
const valueFor = (name: string) => {
  const index = args.findIndex((item) => item === name);
  return index >= 0 ? args[index + 1] : undefined;
};

await mkdir(privateRoot, { recursive: true });
const vacancyTitle = valueFor("--title")?.trim() || "Личный ассистент";

async function readJson<T>(target: string): Promise<T> {
  return JSON.parse(await readFile(target, "utf8")) as T;
}

async function hasFile(target: string) {
  return stat(target).then(() => true, () => false);
}

if (args.includes("--record-consent") && !await hasFile(consentPath)) {
  const consent = { schemaVersion: "private-benchmark-consent/v1", confirmed: true, scope: "local-candidate-quality-benchmark", recordedAtUtc: new Date().toISOString(), source: "explicit-user-authorization-in-project-session" };
  const handle = await open(consentPath, "wx", 0o600); try { await handle.writeFile(`${JSON.stringify(consent)}\n`); } finally { await handle.close(); }
}
if (args.includes("--generate-profile-draft")) {
  const operationId = `private-benchmark-profile-draft-${randomUUID()}`;
  const operation = await generateVacancyProfile(
    { repository: new InMemoryVacancyGenerationRepository(), provider: new RouterAiVacancyProfileProvider(), retryDelayMs: 500 },
    { operationId, title: vacancyTitle },
  );
  if (!operation.generatedProfile || !operation.snapshotHash) throw new Error("PRIVATE_BENCHMARK_PROFILE_DRAFT_FAILED");
  const draft: ProfileDraft = {
    schemaVersion: "private-benchmark-profile-draft/v1",
    title: vacancyTitle,
    sourceOperationId: operation.operationId,
    generatedAtUtc: new Date().toISOString(),
    profileSnapshotHash: operation.snapshotHash,
    generatedProfile: operation.generatedProfile,
  };
  await writeFile(profileDraftPath, `${JSON.stringify(draft, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}
if (args.includes("--approve-profile")) {
  if (!await hasFile(profileDraftPath)) throw new Error("PRIVATE_BENCHMARK_PROFILE_DRAFT_MISSING");
  const draft = await readJson<ProfileDraft>(profileDraftPath);
  const draftChecksum = checksum(await readFile(profileDraftPath));
  const approval: ProfileApproval = {
    schemaVersion: "private-benchmark-profile-approval/v1",
    profileDraftChecksum: draftChecksum,
    title: draft.title,
    profileSnapshotHash: draft.profileSnapshotHash,
    approvedAtUtc: new Date().toISOString(),
    approvedBy: valueFor("--approver")?.trim() || "local-operator",
  };
  await writeFile(profileApprovalPath, `${JSON.stringify(approval, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

const consent = JSON.parse(await readFile(consentPath, "utf8")) as { confirmed?: boolean; scope?: string };
if (consent.confirmed !== true || consent.scope !== "local-candidate-quality-benchmark") throw new Error("PRIVATE_BENCHMARK_CONSENT_REQUIRED");
const draft = await hasFile(profileDraftPath) ? await readJson<ProfileDraft>(profileDraftPath) : null;
const profileApproval = await hasFile(profileApprovalPath) ? await readJson<ProfileApproval>(profileApprovalPath) : null;

const discovered = await files(candidateRoot);
const entries: Entry[] = [];
for (const file of discovered) {
  const bytes = new Uint8Array(await readFile(file));
  entries.push({ path: path.relative(candidateRoot, file), role: classify(file), checksum: checksum(bytes), byteSize: bytes.byteLength, mime: mime(bytes) });
}
if (entries.length !== 9) throw new Error("PRIVATE_BENCHMARK_INVENTORY_CHANGED");
if (entries.filter((entry) => entry.role === "reference-abc").length !== 1 || entries.filter((entry) => entry.role === "reference-result").length !== 1 || !entries.some((entry) => entry.role === "pipeline-input")) throw new Error("PRIVATE_BENCHMARK_ROLE_AMBIGUOUS");
const referenceChecksums = entries.filter((entry) => entry.role.startsWith("reference-")).map((entry) => entry.checksum);
if (entries.filter((entry) => entry.role === "pipeline-input").some((entry) => referenceChecksums.includes(entry.checksum))) throw new Error("PRIVATE_BENCHMARK_REFERENCE_IN_INPUT");
const manifest = { schemaVersion: "private-benchmark-manifest/v1", fixtureId: `private-${checksum(Buffer.from(entries.map((entry) => entry.checksum).join(":"))).slice(0, 16)}`,
  consentProof: { role: "consent-proof", checksum: checksum(await readFile(consentPath)) }, files: entries, denyChecksums: referenceChecksums, oracleVersion: "oracle-v1",
  profileDraft: draft ? {
    path: path.relative(privateRoot, profileDraftPath),
    checksum: checksum(await readFile(profileDraftPath)),
    snapshotHash: draft.profileSnapshotHash,
    title: draft.title,
    schemaVersion: draft.schemaVersion,
  } : undefined,
  profileApproval: profileApproval ? {
    path: path.relative(privateRoot, profileApprovalPath),
    checksum: checksum(await readFile(profileApprovalPath)),
    profileDraftChecksum: profileApproval.profileDraftChecksum,
    approvedAtUtc: profileApproval.approvedAtUtc,
    approvedBy: profileApproval.approvedBy,
  } : undefined,
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

const abc = entries.find((entry) => entry.role === "reference-abc")!;
const result = entries.find((entry) => entry.role === "reference-result")!;
const [abcText, resultText] = await Promise.all([pdfText(path.join(candidateRoot, abc.path)), pdfText(path.join(candidateRoot, result.path))]);
  const oracle = { schemaVersion: "private-benchmark-oracle/v1", version: "oracle-v1", sourceChecksums: referenceChecksums,
  expectedRecommendation: recommendation(`${resultText}\n${abcText}`), abcDirections: directions(abcText), anchors: anchors(`${resultText}\n${abcText}`),
  profileChecksum: draft ? checksum(await readFile(profileDraftPath)) : undefined, profileSnapshotHash: draft?.profileSnapshotHash,
  requiredSections: ["recommendation", "evidence", "risks", "abc-profile"], thresholds: { requiredSectionRecall: 1, significantClaimEvidenceRecall: 1, criticalAnchorRecallMinimum: 0.85, abcGradeMatchMinimum: 0.8, gradeInversionsMaximum: 0, inventedStopFactorsMaximum: 0 } };
await writeFile(oraclePath, `${JSON.stringify(oracle, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

const aggregate = entries.reduce<Record<string, number>>((current, entry) => ({ ...current, [entry.role]: (current[entry.role] ?? 0) + 1 }), {});
console.log(JSON.stringify({ ready: oracle.expectedRecommendation !== "human-review-required" && oracle.abcDirections.length > 0 && oracle.anchors.length > 0,
  files: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.byteSize, 0), roles: aggregate, actualMimes: [...new Set(entries.map((entry) => entry.mime))].sort(),
  consentConfirmed: true, referenceDenyChecksums: referenceChecksums.length, recommendationClassified: oracle.expectedRecommendation !== "human-review-required",
  profileDraftReady: Boolean(draft), profileApproved: Boolean(profileApproval), abcDirections: oracle.abcDirections.length, criticalAnchors: oracle.anchors.length, privateArtifactsWritten: 4, filenamesPrinted: 0, personalTextPrinted: 0 }));
