import { runControlledCanonicalPipeline } from "./pipeline.ts";

export async function runCanonicalCandidatePipelineConformance(input: {
  manifest: { fixtureSetId: string; dataClassification: string };
  evidenceScope: "local-controlled-conformance-only";
}) {
  if (input.evidenceScope !== "local-controlled-conformance-only") throw new Error("UNSUPPORTED_EVIDENCE_SCOPE");
  return runControlledCanonicalPipeline(input.manifest);
}
