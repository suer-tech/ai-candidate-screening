import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { sourceBuildId } from "./source-build-id.ts";

const runtimeFile = path.resolve(import.meta.dirname, "../.runtime/runtime.env");
const temporaryFile = `${runtimeFile}.${process.pid}.tmp`;
const current = await readFile(runtimeFile, "utf8");
const matches = current.match(/^CANDIDATE_PIPELINE_BUILD_ID=.*$/gm) ?? [];
if (matches.length !== 1) throw new Error("LOCAL_BUILD_ID_SETTING_INVALID");
const buildId = await sourceBuildId();
const updated = current.replace(/^CANDIDATE_PIPELINE_BUILD_ID=.*$/m, `CANDIDATE_PIPELINE_BUILD_ID=${buildId}`);
await writeFile(temporaryFile, updated, { encoding: "utf8", mode: 0o600, flag: "wx" });
await rename(temporaryFile, runtimeFile);
console.log(buildId);
