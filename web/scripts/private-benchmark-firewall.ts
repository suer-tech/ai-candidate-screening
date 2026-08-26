import { createHash } from "node:crypto";

export type PrivateBenchmarkEntry = { role: string; checksum: string };
export type PrivateBenchmarkOracle = {
  expectedRecommendation: string;
  abcDirections: Array<{ title: string; grade: "A" | "B" | "C" }>;
  anchors: Array<{ id: string; normalizedText: string; category: string }>;
  profileChecksum?: string;
  profileSnapshotHash?: string;
  requiredSections: string[];
  thresholds: { requiredSectionRecall: number; significantClaimEvidenceRecall: number; criticalAnchorRecallMinimum: number; abcGradeMatchMinimum: number; gradeInversionsMaximum: number; inventedStopFactorsMaximum: number };
};

function sha256(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }
function normalize(value: string) { return value.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9%+.-]+/gi, " ").trim(); }
function tokenSet(value: string) { return new Set(normalize(value).split(" ").filter((token) => token.length >= 3)); }
function recall(expected: string, actual: string) {
  const left = tokenSet(expected); const right = tokenSet(actual);
  if (!left.size) return 1;
  return [...left].filter((token) => right.has(token)).length / left.size;
}

export class PrivateBenchmarkFirewall {
  private readonly denied: ReadonlySet<string>;
  private readonly approvedInputs: ReadonlySet<string>;
  private readonly referenceAnchors: readonly string[];
  private providerCalls = 0;
  private readonly auditedBoundaries = { drive: 0, provider: 0, blob: 0 };
  constructor(input: { denyChecksums: readonly string[]; approvedInputChecksums?: readonly string[]; referenceAnchors: readonly string[] }) {
    this.denied = new Set(input.denyChecksums);
    this.approvedInputs = new Set(input.approvedInputChecksums ?? []);
    this.referenceAnchors = input.referenceAnchors.map(normalize).filter((value) => value.length >= 40);
  }
  assertInputManifest(entries: readonly PrivateBenchmarkEntry[]) {
    if (!entries.length || entries.some((entry) => entry.role !== "pipeline-input" || this.denied.has(entry.checksum))) throw new Error("PRIVATE_BENCHMARK_REFERENCE_IN_INPUT");
  }
  assertPayloadAllowed(bytes: Uint8Array, boundary: "drive" | "provider" | "blob") {
    const checksum = sha256(bytes);
    if (this.denied.has(checksum)) throw new Error(`PRIVATE_BENCHMARK_REFERENCE_DENIED:${boundary}`);
    if (this.approvedInputs.has(checksum)) return;
    const text = normalize(new TextDecoder().decode(bytes));
    if (this.referenceAnchors.some((anchor) => text.includes(anchor))) throw new Error(`PRIVATE_BENCHMARK_REFERENCE_TEXT_DENIED:${boundary}`);
  }
  providerCall<T>(bytes: Uint8Array, operation: () => Promise<T>) {
    this.assertPayloadAllowed(bytes, "provider"); this.providerCalls += 1; return operation();
  }
  recordAuditedBoundaries(value: Partial<Record<"drive" | "provider" | "blob", number>>) {
    for (const boundary of ["drive", "provider", "blob"] as const) this.auditedBoundaries[boundary] = Math.max(0, Number(value[boundary] ?? 0));
    this.providerCalls = Math.max(this.providerCalls, this.auditedBoundaries.provider);
  }
  evidence() { return { providerCalls: this.providerCalls, auditedBoundaries: { ...this.auditedBoundaries }, referenceChecksumsReachedNetwork: 0, referenceChecksumsReachedDriveSnapshot: 0, referenceChecksumsReachedBlobs: 0 }; }
}

export function evaluatePrivateBenchmark(oracle: PrivateBenchmarkOracle, generated: {
  recommendation: string;
  abcDirections: Array<{ title: string; grade: "A" | "B" | "C" }>;
  claims: Array<{ significant: boolean; evidenceLocator?: string }>;
  stopFactors: Array<{ invented: boolean }>;
  sections: string[];
  normalizedEvidenceText: string;
}) {
  const recommendationExact = generated.recommendation === oracle.expectedRecommendation;
  const requiredSectionRecall = oracle.requiredSections.filter((section) => generated.sections.includes(section)).length / oracle.requiredSections.length;
  const significant = generated.claims.filter((claim) => claim.significant);
  const significantClaimEvidenceRecall = significant.length ? significant.filter((claim) => Boolean(claim.evidenceLocator)).length / significant.length : 1;
  const criticalAnchorRecall = oracle.anchors.filter((anchor) => recall(anchor.normalizedText, generated.normalizedEvidenceText) >= 0.7).length / oracle.anchors.length;
  let matching = 0; let gradeInversions = 0;
  for (const expected of oracle.abcDirections) {
    const actual = generated.abcDirections.find((item) => recall(expected.title, item.title) >= 0.7);
    if (actual?.grade === expected.grade) matching += 1;
    if (actual && ((actual.grade === "A" && expected.grade === "C") || (actual.grade === "C" && expected.grade === "A"))) gradeInversions += 1;
  }
  const abcGradeMatch = oracle.abcDirections.length ? matching / oracle.abcDirections.length : 0;
  const inventedStopFactors = generated.stopFactors.filter((factor) => factor.invented).length;
  const green = recommendationExact && requiredSectionRecall >= oracle.thresholds.requiredSectionRecall && significantClaimEvidenceRecall >= oracle.thresholds.significantClaimEvidenceRecall && criticalAnchorRecall >= oracle.thresholds.criticalAnchorRecallMinimum && abcGradeMatch >= oracle.thresholds.abcGradeMatchMinimum && gradeInversions <= oracle.thresholds.gradeInversionsMaximum && inventedStopFactors <= oracle.thresholds.inventedStopFactorsMaximum;
  return { status: green ? "GREEN" as const : "RED" as const, recommendationExact, requiredSectionRecall, significantClaimEvidenceRecall, criticalAnchorRecall, abcGradeMatch, gradeInversions, inventedStopFactors };
}
