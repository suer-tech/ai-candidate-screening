import assert from "node:assert/strict";
import test from "node:test";
import { projectAssessment } from "../server/product/postgres-repository.ts";
import {
  candidateClaimIsDecisionAdmissible,
  canonicalizeVacancyMatrix,
  type CandidateSourceClaim,
  type MatrixCriterionDraft,
} from "../server/candidate-pipeline/matrix-driven.ts";

const sourceRef = "vacancy.resultProfile[0]";
const sourceText = "Организует коммуникации собственника заранее, с полным контекстом и без серии уточняющих вопросов; встречи, подарки и follow-up готовятся заблаговременно.";

function criterion(temporaryId: string, interpretation: string, evaluationRule = "Оценить качественно по релевантному примеру"): MatrixCriterionDraft {
  return {
    temporaryId,
    sourceRefs: [sourceRef],
    sourceText,
    interpretation,
    category: "competency",
    required: false,
    requiredExplanation: "Важность не усилена сверх исходного профиля",
    hardRequired: false,
    operator: "INFORMATIONAL",
    evaluationRule,
    expectedEvidence: [],
    allowedStates: ["Подтверждено", "Не подтверждено", "Недостаточно данных"],
    decisionEffect: "informational",
    missingDataQuestion: "Приведите релевантный пример.",
    interpretationNotes: [],
  };
}

function canonicalize(criteria: MatrixCriterionDraft[]) {
  return canonicalizeVacancyMatrix({
    profileVersion: "vacancy-coverage-first:v1",
    compilerPolicyVersion: "coverage-first/v1",
    skillVersions: { compiler: "compile-vacancy-matrix/v1" },
    sourceFragments: { [sourceRef]: sourceText },
    criteria,
  });
}

test("MDA-002 RED: canonical matrix rejects over-splitting of one semantic profile item", () => {
  const overSplit = [
    criterion("communication-context", "Передаёт полный контекст"),
    criterion("communication-timing", "Готовит касания заранее"),
    criterion("communication-follow-up", "Организует follow-up"),
  ];
  assert.throws(() => canonicalize(overSplit), /MATRIX_(?:PROFILE_)?OVER_SPLIT|MATRIX_COMPACTNESS_VIOLATION/);
});

test("MDA-002 RED: canonical matrix rejects a requirement or threshold absent from source", () => {
  const invented = criterion(
    "invented-sla",
    "Гарантирует ответ каждому контакту не позднее 15 минут",
    "Соответствует только при SLA ответа не более 15 минут и минимум 30 касаний в неделю",
  );
  assert.throws(() => canonicalize([invented]), /MATRIX_INVENTED_(?:REQUIREMENT|THRESHOLD)|MATRIX_FIDELITY_VIOLATION/);
});

test("ASM-014/ASM-070: candidate interview and resume self-report are admissible HR evidence without an independent-source gate", () => {
  const base: Omit<CandidateSourceClaim, "claimId" | "role" | "sourceClass" | "locator" | "provenanceRef"> = {
    candidateId: "candidate-self-report",
    runId: "run-self-report",
    inputVersion: "input-self-report",
    profileVersion: "profile-self-report",
    author: "Кандидат",
    text: "Самостоятельно организовал встречу и подготовил follow-up заранее",
    criterionIds: ["criterion-001"],
    directness: "direct",
  };
  const interview: CandidateSourceClaim = { ...base, claimId: "claim-interview", role: "candidate", sourceClass: "transcript", locator: "utterance-7:12000-18000", provenanceRef: "transcript-v1" };
  const resume: CandidateSourceClaim = { ...base, claimId: "claim-resume", role: "candidate", sourceClass: "resume", locator: "resume-page-2:experience", provenanceRef: "resume-v1" };
  assert.equal(candidateClaimIsDecisionAdmissible(interview), true);
  assert.equal(candidateClaimIsDecisionAdmissible(resume), true);
});

test("REP-020 RED: positive matrix rows populate non-empty strengths and competencies", () => {
  const overview = projectAssessment({
    recommendation: "Рекомендовать",
    structuredAssessment: {
      matrixCriteria: {
        "criterion-001": { category: "competency", sourceText: "Проактивно организует коммуникации", interpretation: "Работает на опережение" },
      },
      matrixRows: [{
        criterionId: "criterion-001",
        state: "Подтверждено",
        reason: "Кандидат привёл конкретный релевантный пример",
        supportingClaimIds: ["claim-interview"],
        contradictingClaimIds: [],
        checkedSourceIds: ["transcript-v1"],
        missingData: "",
        followUpQuestion: "",
        verificationState: "NOT_REQUIRED",
      }],
      observations: [], abcStates: {}, abcEvidence: {}, competencies: [], accessToKe: [], risks: [], stopFactors: [],
    },
  }, {
    facts: [{ id: "claim-interview", predicate: "competency_evidence", value: "Организовал встречу и follow-up заранее", locator: { kind: "transcript", speakerLabel: "Кандидат", startMs: 12_000, exactText: "Я заранее собрал контекст и организовал встречу" } }],
  });
  assert.ok(overview);
  assert.ok((overview.strengths?.length ?? 0) > 0, `positive row did not create strengths: ${JSON.stringify(overview)}`);
  assert.ok(overview.competencies.length > 0, `positive competency row was lost: ${JSON.stringify(overview)}`);
  assert.match(overview.competencies[0]?.factIds[0] ?? "", /^evidence-legacy-/, "public projection must replace internal claim IDs");
});
