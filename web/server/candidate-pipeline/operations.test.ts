import assert from "node:assert/strict";
import test from "node:test";
import { CandidateCleanupGoal, MilestoneRecorder, errorTelegramTemplate, successTelegramTemplate } from "./operations.ts";

test("Telegram templates expose HR facts and direct result link without secrets or internal errors", () => {
  const success = successTelegramTemplate({ candidate: "Кандидат", vacancy: "Вакансия", recommendation: "Рекомендовать", accessToKe: "Допущен", resultPdfUrl: "https://drive.google.com/result" });
  assert.match(success, /Итоговый PDF: https:\/\/drive\.google\.com\/result/);
  assert.doesNotMatch(success, /token|chat_id|stack/i);
  const failed = errorTelegramTemplate({ candidate: "Кандидат", vacancy: "Вакансия", safeReason: "CORRUPT_FILE", fileName: "resume.pdf" });
  assert.match(failed, /resume\.pdf/);
  assert.doesNotMatch(failed, /exception|trace/i);
});

test("metrics use monotonic duration, UTC milestones, retries and guarded ETA", () => {
  let tick = 100; let utc = 0;
  const recorder = new MilestoneRecorder(() => new Date(1_700_000_000_000 + utc++ * 1000), () => tick);
  recorder.start("assessment", 50); recorder.retry("assessment"); recorder.providerWait("assessment", 75); tick = 350;
  const metric = recorder.finish("assessment", "SUCCEEDED");
  assert.equal(metric.durationMs, 250); assert.equal(metric.retries, 1); assert.equal(metric.providerWaitMs, 75); assert.match(metric.startedAtUtc, /Z$/);
  assert.equal(recorder.eta(Array(9).fill(100)).available, false);
});

test("cleanup remains incomplete until every domain/provider/temp/report adapter confirms", async () => {
  const incomplete = await new CandidateCleanupGoal([{ key: "domain", cleanup: async () => true }, { key: "provider", cleanup: async () => false }]).execute("candidate-1", "folder-1");
  assert.equal(incomplete.state, "INCOMPLETE"); assert.equal(incomplete.tombstone, undefined);
  const complete = await new CandidateCleanupGoal([{ key: "domain", cleanup: async () => true }, { key: "provider", cleanup: async () => true }, { key: "temp", cleanup: async () => true }, { key: "reports", cleanup: async () => true }]).execute("candidate-1", "folder-1");
  assert.equal(complete.state, "COMPLETE"); assert.equal(complete.tombstone?.driveFolderId, "folder-1");
});
