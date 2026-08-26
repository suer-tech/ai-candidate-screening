import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildCanonicalBaselineEvidence, runCanonicalPipelineConformance } from "../helpers/canonical-pipeline-conformance-harness.mjs";

const outputFlag = process.argv.indexOf("--output");
const outputPath = outputFlag >= 0 ? process.argv[outputFlag + 1] : undefined;
const result = await runCanonicalPipelineConformance();
const evidence = buildCanonicalBaselineEvidence(result);
const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
if (outputPath) {
  const resolved = path.resolve(outputPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, serialized, "utf8");
}
process.stdout.write(serialized);
if (evidence.counts.red > 0) process.exitCode = 1;
