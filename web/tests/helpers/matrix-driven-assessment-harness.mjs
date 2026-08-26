import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const adapterContractPath = "server/candidate-pipeline/matrix-driven-conformance.ts";
const adapterPath = path.resolve(adapterContractPath);
const manifestPath = path.resolve("tests/fixtures/matrix-driven-assessment/manifest.json");

let manifestCache;

async function loadManifest() {
  manifestCache ??= JSON.parse(await readFile(manifestPath, "utf8"));
  return manifestCache;
}

function unavailableResult(scenario, status = "NOT_IMPLEMENTED", adapter = { available: false }) {
  return {
    schemaVersion: "matrix-driven-conformance-result/v1",
    scenarioId: scenario.scenarioId,
    status,
    fixtureSetId: scenario.fixtureSetId,
    dataClassification: scenario.dataClassification,
    externalCalls: 0,
    adapter: { path: adapterContractPath, ...adapter },
    observation: {},
  };
}

export async function runMatrixDrivenScenario(scenario) {
  const manifest = await loadManifest();
  if (!existsSync(adapterPath)) return unavailableResult(scenario);
  try {
    const module = await import(`${pathToFileURL(adapterPath).href}?matrixAcceptance=${Date.now()}`);
    if (typeof module.runMatrixDrivenAssessmentConformance !== "function") {
      return unavailableResult(scenario, "INVALID_ADAPTER", { available: true, callable: false });
    }
    return await module.runMatrixDrivenAssessmentConformance({
      manifest: structuredClone(manifest),
      scenario: structuredClone(scenario),
      evidenceScope: "local-controlled-synthetic-only",
    });
  } catch (error) {
    return unavailableResult(scenario, "ADAPTER_ERROR", {
      available: true,
      callable: true,
      safeError: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

function push(failures, condition, message) {
  if (!condition) failures.push(message);
}

function verifyKind(observation, kind, failures) {
  const values = observation ?? {};
  switch (kind) {
    case "lazy-shared":
      push(failures, values.compilationsBeforeFirstCandidate === 0, "matrix must not compile at profile activation");
      push(failures, values.compilationCount === 1, "first candidate must cause exactly one shared compilation");
      push(failures, values.compilerCandidateMaterialCount === 0, "candidate materials must not enter compiler input");
      push(failures, values.candidateChecksums?.length === 2 && new Set(values.candidateChecksums).size === 1, "both candidates must reuse one checksum");
      break;
    case "concurrent-claim":
      push(failures, values.claimWinners === 1, "concurrent compilation must have one claim winner");
      push(failures, values.publishedArtifactCount === 1, "one profileVersion must publish one artifact");
      push(failures, values.waitersContinued === 2, "both candidate waiters must continue");
      push(failures, values.waiterChecksums?.length === 2 && new Set(values.waiterChecksums).size === 1, "waiters must observe one checksum");
      break;
    case "lease-fencing":
      push(failures, values.leaseRecovered === true, "expired compilation lease must be recoverable");
      push(failures, values.staleOwnerPublishDenied === true, "stale fencing token must not publish");
      push(failures, values.publishedByCurrentOwner === true && values.publishedArtifactCount === 1, "current owner alone must publish once");
      break;
    case "immutable-reuse":
      push(failures, values.mutationDenied === true, "published matrix must be immutable");
      push(failures, values.regenerationCountAfterPolicyChange === 0, "policy update must not regenerate old profileVersion matrix");
      push(failures, values.checksumBefore === values.checksumAfter && Boolean(values.checksumBefore), "checksum must remain stable");
      break;
    case "critic-isolation":
      push(failures, values.compilerReceivedAllSourceRefs === true, "compiler must receive the full profile");
      push(failures, values.compilerCandidateMaterialCount === 0, "compiler must not receive candidate data");
      push(failures, values.criticContextContainsCompilerReasoning === false, "critic context must exclude compiler reasoning");
      push(failures, values.compilerTraceId && values.criticTraceId && values.compilerTraceId !== values.criticTraceId, "compiler and critic require separate protected traces");
      push(failures, values.compilerCapability !== values.criticCapability, "compiler and critic require separate capabilities");
      break;
    case "invalid-source-ref":
      push(failures, values.publishDenied === true, "unknown exact sourceRef must deny publish");
      push(failures, values.errorCode === "MATRIX_SOURCE_REF_INVALID", "sourceRef rejection must be typed");
      push(failures, values.publishedArtifactCount === 0, "invalid sourceRef must not partially publish");
      break;
    case "best-effort-no-threshold":
      push(failures, values.criterionCreated === true, "qualitative requirement must still compile");
      push(failures, values.sourceRef === "profile.qualitativeMeetings", "criterion must preserve exact sourceRef");
      push(failures, typeof values.interpretationNote === "string" && values.interpretationNote.length > 0, "qualitative interpretation note is required");
      push(failures, values.inventedNumericThresholds?.length === 0, "qualitative text must not gain numeric thresholds");
      break;
    case "invented-policy-repair":
      push(failures, values.initialCriticDecision === "REPAIR_REQUIRED", "critic must reject invented threshold/stop factor");
      push(failures, values.violationCodes?.includes("INVENTED_THRESHOLD") && values.violationCodes?.includes("INVENTED_STOP_FACTOR"), "critic must identify both inventions");
      push(failures, values.publishedDraftContainsInventions === false, "published matrix must exclude inventions");
      push(failures, values.productionRoutingAllowed === false, "shadow invention must block production routing");
      break;
    case "bounded-fingerprint":
      push(failures, values.repairCycles <= 2, "repair cycles must be at most two");
      push(failures, values.llmCalls <= 6, "matrix compilation calls must be at most six");
      push(failures, values.sameFingerprintRetries <= 1, "same unchanged obstacle may be retried once");
      push(failures, values.status === "FAILED" && typeof values.terminalErrorCode === "string", "repeated obstacle must end with typed failure");
      push(failures, values.publishedArtifactCount === 0, "bounded failure must not publish partial matrix");
      break;
    case "claims-not-facts":
      push(failures, values.recordKind === "SOURCE_CLAIM", "candidate self-description must be stored as a source claim");
      push(failures, values.independentlyVerified === false, "repeated self-description is not independent verification");
      push(failures, values.independentSourceCount === 0, "resume/interview repetition from candidate is one source class");
      push(failures, values.author && values.role && values.locator && values.provenanceRef, "claim attribution and provenance are required");
      break;
    case "full-context":
      push(failures, values.decisionContextChars > 240, "decision evidence must not be capped at 240 characters");
      push(failures, values.includesQuestion === true && values.includesAnswer === true, "context must preserve question and answer");
      push(failures, values.neighborTurnCount >= 2, "context must preserve neighboring turns");
      push(failures, values.fullContextRetrievable === true, "full source context must remain retrievable");
      break;
    case "speaker-gate":
      push(failures, values.interviewerAttributedAsCandidate === false, "interviewer question must not become candidate claim");
      push(failures, values.unknownRoleUsedAsSoleDecisionEvidence === false, "unknown role cannot be sole decision evidence");
      push(failures, values.rowState === "Недостаточно данных", "only unknown-role evidence must yield insufficient data");
      break;
    case "global-conflict":
      push(failures, values.globalPassExecuted === true, "global conflict pass is required after batches");
      push(failures, values.conflicts?.length === 1, "cross-batch contradiction must create one conflict");
      push(failures, values.conflicts?.[0]?.claimIds?.length === 2, "conflict must retain both claim sides");
      push(failures, typeof values.conflicts?.[0]?.followUpQuestion === "string", "conflict must include follow-up question");
      break;
    case "unmapped-informational":
      push(failures, values.signalClass === "INFORMATIONAL", "unmapped signal must remain informational");
      push(failures, values.createdCriterionCount === 0 && values.createdStopFactorCount === 0 && values.createdHardRequiredCount === 0, "candidate material must not create decision rules");
      push(failures, typeof values.recommendationBefore === "string" && values.recommendationBefore === values.recommendationAfter, "unmapped signal must not change recommendation");
      break;
    case "row-coverage":
      push(failures, values.initialValidation === "REJECTED", "missing criterion row must reject assessment");
      push(failures, values.missingCriterionIds?.length === 1 && values.missingCriterionIds[0] === "criterion-2", "gate must identify exact missing row");
      push(failures, values.repairRequestedCriterionIds?.length === 1 && values.repairRequestedCriterionIds[0] === "criterion-2", "repair must be limited to missing row");
      push(failures, values.finalRowIds?.length === 3 && new Set(values.finalRowIds).size === 3, "final assessment must cover every criterion exactly once");
      break;
    case "abc-sufficiency":
      push(failures, values.admissibleLocatorCount >= 1, "ABC requires at least one admissible locator");
      push(failures, values.coverageComplete === false, "fixture intentionally covers only part of A");
      push(failures, values.assignedLevel === null && values.rowState === "Недостаточно данных", "partial A evidence must not force A/B/C");
      break;
    case "critical-verification":
      push(failures, ["stopFactor", "hardRequired", "required", "conflict", "recommendation-changing"].every((kind) => values.requiredVerificationKinds?.includes(kind)), "all critical classes must be selected for verification");
      push(failures, values.unverifiedCriticalRowIds?.length === 0, "no critical row may remain unverified");
      push(failures, values.verifierTraceIds?.length >= 1, "independent verification trace is required");
      push(failures, values.verifierContextContainsEvaluatorReasoning === false, "verifier must use a clean context");
      break;
    case "recommendation-formula": {
      const expected = {
        stopFactorAndMissingRequired: "Не рекомендовать",
        hardRequiredMismatch: "Не рекомендовать",
        requiredUnknown: "Недостаточно данных",
        normalRequiredMismatch: "Не рекомендовать",
        riskOnly: "Рекомендовать с оговорками",
        allClear: "Рекомендовать",
        abcOnly: "Рекомендовать",
        unmappedOnly: "Рекомендовать",
      };
      for (const [branch, recommendation] of Object.entries(expected)) push(failures, values.branches?.[branch] === recommendation, `${branch} must deterministically yield ${recommendation}`);
      push(failures, values.formulaInputsPersisted === true && values.selectedBranchPersisted === true, "formula inputs and selected branch must be persisted");
      break;
    }
    case "prompt-injection":
      push(failures, values.materialTreatedAsUntrustedData === true, "candidate instructions must be untrusted data");
      push(failures, values.instructionExecuted === false, "prompt injection must not change workflow");
      push(failures, values.recommendation === "Недостаточно данных", "injection text must not manufacture a positive recommendation");
      break;
    case "sensitive-exclusion":
      push(failures, values.decisionContextSensitiveMatches === 0, "prohibited sensitive values must be absent from decision context");
      push(failures, values.decisionClaimSensitiveFieldCount === 0, "prohibited sensitive fields must not create decision claims");
      push(failures, values.rawLocatorIdentityPreserved === true, "masking must preserve scoped locator identity");
      push(failures, values.userReasoningSensitiveMatches === 0, "user reasoning must not expose sensitive values");
      break;
    case "cross-candidate-isolation":
      push(failures, values.sharedMatrixReused === true, "vacancy matrix may be shared");
      push(failures, values.candidateAClaimVisibleToCandidateB === false, "claims must not cross candidate scope");
      push(failures, values.candidateAEvidenceVisibleToCandidateB === false, "evidence must not cross candidate scope");
      push(failures, values.candidateAWorkingMemoryVisibleToCandidateB === false, "working memory must not cross candidate scope");
      break;
    case "shadow-side-effects":
      push(failures, values.shadowArtifactsPersisted === true, "shadow artifacts and metrics must be retained");
      push(failures, values.drivePublicationCalls === 0 && values.telegramCalls === 0 && values.publicResultMutations === 0, "shadow workflow must have no user side effects");
      push(failures, values.productionRoutingAllowed === false, "failed shadow quality gate must block production routing");
      break;
    case "fixed-workflow-version":
      push(failures, values.runWorkflowVersion === "legacy-v1", "run must retain workflowVersion fixed at creation");
      push(failures, values.mixedArtifactKinds === false, "one run must not mix legacy and matrix artifacts");
      push(failures, values.rollbackAffectedExistingRun === false, "routing changes affect only new runs");
      break;
    case "legacy-immutability":
      push(failures, values.originalResultVersion === "result-v1" && values.originalResultMutated === false, "completed legacy result must remain immutable");
      push(failures, values.reprocessCreatedNewRun === true && values.reprocessCreatedNewResultVersion === true, "manual reprocess must create new run/result version");
      push(failures, values.previousResultStillReadable === true, "previous result must remain readable");
      break;
    case "two-pdf-report":
      push(failures, values.publishedFiles?.length === 2, "exactly two user result files must be published");
      push(failures, ["executive-summary-pdf", "full-assessment-pdf"].every((kind) => values.publishedFiles?.some((file) => file.kind === kind)), "PDF pair must contain the two established report kinds");
      push(failures, values.publishedFiles?.every((file) => file.mediaType === "application/pdf"), "both published files must be PDF");
      push(failures, values.fullReportCriterionIds?.length === 3 && new Set(values.fullReportCriterionIds).size === 3, "full report must cover all matrix rows");
      push(failures, values.sourceTextDistinctFromInterpretation === true, "report must distinguish source text from interpretation");
      push(failures, values.thirdUserFilePublished === false, "matrix data must not create a third file");
      break;
    case "release-regression-gate":
      push(failures, ["matrix-driven-acceptance", "E2E-VAC-001", "E2E-TRN-001", "E2E-ABC-001", "E2E-RESULT-001"].every((suite) => values.requiredSuites?.includes(suite)), "cutover gate must require matrix acceptance and all four mandatory E2E suites");
      push(failures, values.allSuitesSameBuild === true && values.buildId === "build-synthetic-matrix-v1", "release evidence must refer to one immutable build");
      push(failures, values.productionRoutingAllowed === false, "one failed mandatory suite must block production routing");
      push(failures, values.blockingSuites?.length === 1 && values.blockingSuites[0] === "E2E-ABC-001", "gate must identify the failing mandatory suite");
      break;
    case "llm-semantic-requiredness":
      push(failures, values.vacancyWriteContractHasRequirementsField === false, "vacancy write contract must not expose a separate requirements field");
      push(failures, values.vacancyWriteContractHasRequiredToggle === false && values.vacancyWriteContractHasHardRequiredToggle === false, "vacancy UI/API must not require required or hardRequired toggles");
      push(failures, values.requirednessAssignedBy === "compile-vacancy-matrix/v1", "LLM matrix compiler must assign semantic requiredness");
      push(failures, values.criteria?.length === 2, "compiler result must include both required and optional semantic examples");
      push(failures, values.criteria?.find((item) => item.sourceRef === "profile.requiredExperience")?.required === true, "semantically mandatory criterion must compile as required");
      push(failures, values.criteria?.find((item) => item.sourceRef === "profile.optionalPreference")?.required === false, "optional preference must not compile as required");
      push(failures, values.criteria?.every((item) => typeof item.requiredExplanation === "string" && item.requiredExplanation.length > 0), "every requiredness decision needs an explanation");
      push(failures, values.criticCheckedRequiredness === true && values.criticContextContainsCompilerReasoning === false, "independent critic must verify requiredness in a clean context");
      break;
    case "hard-required-iff-stop-factor": {
      const stopCriterion = values.criteria?.find((item) => item.sourceRef === "profile.stopFactorDisclosure");
      const normalCriterion = values.criteria?.find((item) => item.sourceRef === "profile.requiredExperience");
      push(failures, stopCriterion?.sourceSection === "stopFactors" && stopCriterion?.hardRequired === true, "every stop-factor source criterion must have hardRequired=true");
      push(failures, normalCriterion?.sourceSection !== "stopFactors" && normalCriterion?.hardRequired === false, "non-stop-factor criterion must have hardRequired=false");
      push(failures, values.invalidDraftResults?.length === 2 && values.invalidDraftResults.every((item) => item.accepted === false), "both directions of hardRequired/source-section mismatch must be rejected");
      push(failures, values.invalidDraftResults?.every((item) => item.errorCode === "MATRIX_HARD_REQUIRED_SOURCE_MISMATCH"), "hardRequired correspondence rejection must be typed");
      push(failures, values.productionRoutingAllowed === false, "shadow gate must block inaccurate hardRequired mapping");
      break;
    }
    case "required-mismatch-rejection":
      push(failures, values.required === true && values.mismatchProven === true, "fixture must reach a proven required mismatch");
      push(failures, values.admissibleEvidenceLocatorCount >= 1, "required mismatch needs admissible evidence");
      push(failures, values.recommendation === "Не рекомендовать", "proven required mismatch must produce rejection");
      push(failures, values.selectedFormulaBranch === "REQUIRED_MISMATCH", "formula must persist the required-mismatch branch");
      break;
    case "verified-critical-unmapped-risk":
      push(failures, values.openPassDecisionEffect === "INFORMATIONAL", "open pass alone must remain informational");
      push(failures, values.riskAssessmentSkill === "assess-unmapped-risk/v1" && values.riskAssessmentDecision === "PROPOSE_CRITICAL", "separate risk skill must propose criticality");
      push(failures, values.riskVerificationSkill === "verify-critical-risk/v1" && values.riskVerificationDecision === "VERIFIED_CRITICAL", "independent verification must confirm criticality");
      push(failures, values.riskAssessmentTraceId && values.riskVerificationTraceId && values.riskAssessmentTraceId !== values.riskVerificationTraceId, "assessment and verification require distinct protected traces");
      push(failures, values.verifierContextContainsRiskAssessmentReasoning === false, "critical-risk verifier must receive a clean context");
      push(failures, values.evidenceLocators?.length >= 1 && values.evidenceLocators.every((locator) => locator.startsWith("transcript:synthetic:") || locator.startsWith("document:synthetic:")), "verified risk requires candidate-scoped admissible locators");
      push(failures, values.sharedMatrixMutated === false && values.createdCriterionCount === 0 && values.createdStopFactorCount === 0, "candidate risk must not mutate the shared matrix or create a stop factor");
      push(failures, values.criticalUnmappedRisk === true && values.recommendation === "Не рекомендовать", "independently verified critical risk must produce rejection");
      push(failures, values.snapshotContainsRiskProvenance === true && values.selectedFormulaBranch === "CRITICAL_UNMAPPED_RISK", "snapshot must retain risk provenance and formula branch");
      break;
    case "unverified-risk-non-rejection": {
      const failed = values.cases?.find((item) => item.id === "verification-failed");
      const noncritical = values.cases?.find((item) => item.id === "verified-noncritical");
      push(failures, failed?.criticalUnmappedRisk === false && failed?.signalClass === "INFORMATIONAL", "failed verification must leave signal informational");
      push(failures, failed?.recommendation !== "Не рекомендовать" && typeof failed?.recommendation === "string", "failed verification cannot reject the candidate");
      push(failures, noncritical?.criticalUnmappedRisk === false && noncritical?.signalClass === "CAVEAT", "verified noncritical risk may only become a caveat");
      push(failures, noncritical?.recommendation === "Рекомендовать с оговорками", "noncritical risk must use caveat recommendation branch");
      push(failures, values.productionRoutingAllowedWithoutVerification === false, "shadow gate must block a rejection based on unverified risk");
      break;
    }
    case "sensitive-irrelevant-risk-exclusion":
      push(failures, values.decisionSafeSignalCount === 1, "sensitive content must be filtered while the irrelevant synthetic signal remains auditable");
      push(failures, values.riskAssessmentSensitiveMatches === 0 && values.riskVerificationSensitiveMatches === 0, "risk skills must not receive prohibited sensitive values");
      push(failures, values.signals?.find((item) => item.id === "sensitive")?.eligibleForCriticalAssessment === false, "sensitive signal cannot enter critical assessment");
      push(failures, values.signals?.find((item) => item.id === "irrelevant")?.criticalUnmappedRisk === false, "role-irrelevant signal cannot become critical");
      push(failures, values.verifiedCriticalRiskCount === 0 && values.recommendation !== "Не рекомендовать", "sensitive or irrelevant signals cannot cause rejection");
      push(failures, values.sharedMatrixMutated === false, "filtered signals must not mutate the matrix");
      break;
    default:
      failures.push(`unknown oracle kind ${JSON.stringify(kind)}`);
  }
}

export function verifyMatrixDrivenScenario(result, scenario) {
  const failures = [];
  push(failures, result?.scenarioId === scenario.scenarioId, "result must preserve scenarioId");
  push(failures, result?.fixtureSetId === scenario.fixtureSetId, "result must preserve fixtureSetId");
  push(failures, result?.dataClassification === scenario.dataClassification, "result must preserve synthetic classification");
  push(failures, result?.externalCalls === 0, "acceptance harness must not make provider/network calls");
  push(failures, result?.adapter?.available === true && result?.adapter?.callable !== false, `production conformance adapter is required at ${adapterContractPath}`);
  push(failures, result?.status === "SUCCEEDED", `scenario status expected SUCCEEDED; actual=${JSON.stringify(result?.status)}`);
  verifyKind(result?.observation, scenario.oracle.kind, failures);
  return failures;
}

export function toSafeEvidenceCase(scenario, result, failures) {
  return {
    scenarioId: scenario.scenarioId,
    group: scenario.group,
    requirements: scenario.requirements,
    status: failures.length === 0 ? "GREEN" : "RED",
    failures,
    adapter: result.adapter,
    productStatus: result.status,
    externalCalls: result.externalCalls,
  };
}
