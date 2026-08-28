import assert from "node:assert/strict";
import test from "node:test";
import { PROMPT_ARTIFACTS } from "../server/llm/artifacts.ts";
import * as productionRuntime from "../server/candidate-pipeline/production-runtime.ts";

type OrganizationalFact = {
  id: string;
  predicate: string;
  value: string;
  locator?: Record<string, unknown>;
};

type ProjectOrganizationalConditions = (facts: readonly OrganizationalFact[]) => readonly string[];

test("REP-023: existing fact_extraction explicitly requests four separate grounded organizational facts", () => {
  const prompt = PROMPT_ARTIFACTS["fact-extraction/v1"].template;
  const failures: string[] = [];
  const subjects: Array<[string, RegExp]> = [
    ["work format and city", /(?:work\s*format|формат\s+работы).*(?:city|город)|(?:city|город).*(?:work\s*format|формат\s+работы)/isu],
    ["expected net income", /(?:expected\s+(?:net\s+)?income|income\s+after\s+tax|ожидаем\S*\s+(?:доход|зарплат)|доход\S*\s+(?:на\s+руки|после\s+налог))/isu],
    ["trial-day readiness", /(?:trial\s+day|тестов\S*\s+дн)/isu],
    ["start readiness and timing", /(?:start\s+(?:readiness|availability|date)|готов\S*\s+(?:к\s+)?выход)/isu],
  ];
  for (const [label, pattern] of subjects) if (!pattern.test(prompt)) failures.push(`fact_extraction prompt omits ${label}`);
  if (!/(?:separate|отдельн)/iu.test(prompt)) failures.push("prompt does not require the four subjects as separate facts");
  if (!/locatorRef/u.test(prompt)) failures.push("prompt does not require a supplied source locator for every fact");
  if (!/(?:never infer missing|не (?:выдум|додум|предполаг))/iu.test(prompt)) failures.push("prompt does not prohibit invented answers for missing organizational facts");
  assert.deepEqual(failures, []);
});

test("REP-023: report projection renders exactly four grounded organizational lines and explicit missing defaults without an LLM call", () => {
  const project = (productionRuntime as Record<string, unknown>).projectOrganizationalConditions as ProjectOrganizationalConditions | undefined;
  assert.equal(typeof project, "function", "public projectOrganizationalConditions(facts) boundary is missing");

  const facts: OrganizationalFact[] = [
    { id: "fact-format", predicate: "conditions.work_format_city", value: "гибридный формат, Москва", locator: { kind: "transcript", recordingId: "synthetic", startMs: 10_000, endMs: 14_000, exactText: "Подходит гибрид в Москве." } },
    { id: "fact-income", predicate: "conditions.expected_net_income", value: "250 000 ₽ на руки", locator: { kind: "document", fileName: "Synthetic resume.pdf", page: 1, exactText: "Ожидаемый доход — 250 000 рублей на руки." } },
    { id: "fact-trial", predicate: "conditions.trial_day_readiness", value: "готов", locator: { kind: "transcript", recordingId: "synthetic", startMs: 20_000, endMs: 23_000, exactText: "Да, к тестовому дню готов." } },
    { id: "fact-start", predicate: "conditions.start_readiness", value: "готов через две недели", locator: { kind: "transcript", recordingId: "synthetic", startMs: 30_000, endMs: 34_000, exactText: "Смогу выйти через две недели." } },
    { id: "ungrounded-format", predicate: "conditions.work_format_city", value: "полностью удалённо, Казань" },
  ];
  const expected = [
    "Формат: гибридный формат, Москва;",
    "Доход: 250 000 ₽ на руки;",
    "Готов к тестовому дню: готов;",
    "Готов к выходу: готов через две недели;",
  ];
  let providerCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { providerCalls += 1; throw new Error("organizational projection must not call an LLM"); }) as typeof fetch;
  try {
    assert.deepEqual(project!(facts), expected);
    assert.deepEqual(project!([facts[0], facts[1]]), [
      "Формат: гибридный формат, Москва;",
      "Доход: 250 000 ₽ на руки;",
      "Готов к тестовому дню: не указано;",
      "Готов к выходу: не указано;",
    ]);
    assert.equal(providerCalls, 0, "projection introduced an additional LLM/provider call");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
