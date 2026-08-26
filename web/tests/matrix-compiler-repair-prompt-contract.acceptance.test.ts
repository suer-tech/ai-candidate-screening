import assert from "node:assert/strict";
import test from "node:test";
import { PROMPT_ARTIFACTS } from "../server/llm/artifacts.ts";

type PromptGuard = Readonly<{
  id: string;
  description: string;
  accepts: (template: string) => boolean;
}>;

function missingGuards(template: string, guards: readonly PromptGuard[]): string[] {
  return guards
    .filter((guard) => !guard.accepts(template))
    .map((guard) => `${guard.id}: ${guard.description}`);
}

const compilerGuards: readonly PromptGuard[] = [
  {
    id: "atomic-conjunction-and-list-decomposition",
    description: "explicitly decompose every conjunction and list into atomic child nodes while preserving ALL_OF/ANY_OF semantics",
    accepts: (text) => /кажд(?:ое|ую|ый)[\s\S]{0,100}(?:перечислен|спис|союз|услов)[\s\S]{0,180}(?:дочерн|атомарн)/i.test(text)
      && /(?:декомпоз|разбив|разлож)[\s\S]{0,160}(?:ALL_OF|ANY_OF)/i.test(text),
  },
  {
    id: "existing-source-fragments-only",
    description: "copy sourceRefs only from exact existing sourceFragments and never synthesize a locator",
    accepts: (text) => /sourceFragments/i.test(text)
      && /(?:только|исключительно)[\s\S]{0,120}(?:существующ|передан)[\s\S]{0,100}(?:sourceFragments|sourceRef)/i.test(text)
      && /(?:не (?:создавай|выдумывай|синтезируй)|запрещено[^.]{0,80}(?:создавать|выдумывать))[^.]{0,100}(?:sourceRef|локатор)/i.test(text),
  },
  {
    id: "unavailable-abc-is-omitted",
    description: "omit unavailable/incomplete ABC grading rules instead of emitting a candidate assessment state",
    accepts: (text) => /(?:неполн|недоступн|отсутств)[^.]{0,100}(?:ABC|определени[яе] A)/i.test(text)
      && /(?:не создавай|пропусти|не включай|исключи)[^.]{0,120}(?:критери|градаци|оценк)/i.test(text)
      && /Недостаточно данных/i.test(text)
      && /(?:не (?:является|используй|возвращай)|вместо)[^.]{0,120}(?:состояни|матриц)/i.test(text),
  },
  {
    id: "required-implies-required-gap",
    description: "map every non-stop required criterion coherently to decisionEffect=required-gap",
    accepts: (text) => /required\s*=\s*true/i.test(text)
      && /decisionEffect\s*=\s*required-gap/i.test(text)
      && /(?:кроме|за исключением|не стоп)[^.]{0,100}(?:стоп|hardRequired)/i.test(text),
  },
  {
    id: "non-empty-cardinality",
    description: "use AT_LEAST_N only with positive atLeast not exceeding a non-empty child set; otherwise keep atLeast null",
    accepts: (text) => /AT_LEAST_N/i.test(text)
      && /atLeast/i.test(text)
      && /(?:положительн|не менее 1|>=?\s*1)/i.test(text)
      && /(?:children|дочерн)[^.]{0,100}(?:не пуст|не превыш|достаточ)/i.test(text)
      && /(?:не AT_LEAST_N|остальн|других оператор)[^.]{0,100}atLeast\s*=\s*null/i.test(text),
  },
];

const repairGuards: readonly PromptGuard[] = [
  {
    id: "preserve-untouched-nodes-order-and-source-refs",
    description: "preserve every untouched node, its order and exact sourceRefs",
    accepts: (text) => /сохран[^.]{0,160}(?:остальн|нетронут|не затронут)[^.]{0,160}(?:узл)/i.test(text)
      && /порядок/i.test(text)
      && /sourceRefs?/i.test(text),
  },
  {
    id: "preserve-tree-topology",
    description: "do not collapse, flatten, regroup or rebuild the criterion tree",
    accepts: (text) => /не (?:схлопывай|уплощай|перегруппировывай|перестраивай)[^.]{0,120}(?:дерев|иерарх|узл)/i.test(text),
  },
  {
    id: "resolve-all-active-violations",
    description: "resolve every listed active versioned violation in the returned successor",
    accepts: (text) => /(?:все|кажд)[^.]{0,100}(?:перечислен|активн)[^.]{0,100}(?:violation|нарушен)/i.test(text)
      && /(?:устрани|исправ|разреш)[^.]{0,100}(?:в successor|в возвращ|до возврат)/i.test(text),
  },
  {
    id: "recheck-no-new-semantic-drift",
    description: "recheck the complete successor against the profile for newly introduced semantic drift before returning",
    accepts: (text) => /(?:повторно|перед возврат|после исправлен)[^.]{0,120}(?:проверь|перепроверь)/i.test(text)
      && /(?:нов(?:ое|ых|ый)[^.]{0,60}(?:искажен|дрейф|усилен|правил)|семантическ[^.]{0,60}(?:дрейф|искажен))/i.test(text),
  },
  {
    id: "single-bounded-successor",
    description: "return one complete successor for external re-critique; do not start an internal unbounded repair loop",
    accepts: (text) => /(?:один|единственн)[^.]{0,100}(?:полный|complete)[^.]{0,100}successor/i.test(text)
      && /(?:повторн[^.]{0,60}критик|re-critique|нов[^.]{0,60}critic)/i.test(text)
      && /(?:не запускай|не выполняй)[^.]{0,120}(?:цикл|самостоятельн[^.]{0,40}repair)/i.test(text),
  },
];

test("MDA-003-PROMPT-RED: compiler contract prevents coarse or semantically drifting matrix drafts", () => {
  const artifact = PROMPT_ARTIFACTS["compile-vacancy-matrix/v1"];
  assert.equal(artifact.id, "compile-vacancy-matrix");
  assert.equal(artifact.version, "v1");
  assert.deepEqual(missingGuards(artifact.template, compilerGuards), []);
});

test("MDA-004-PROMPT-RED: each of at most two repairs is surgical, complete, topology-preserving and re-criticable", () => {
  const artifact = PROMPT_ARTIFACTS["repair-vacancy-matrix/v1"];
  assert.equal(artifact.id, "repair-vacancy-matrix");
  assert.equal(artifact.version, "v1");
  assert.deepEqual(missingGuards(artifact.template, repairGuards), []);
});
