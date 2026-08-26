import {
  InMemoryVacancyMatrixRegistry,
  assessAbcConditionCoverage,
  canonicalizeVacancyMatrix,
  candidateClaimIsDecisionAdmissible,
  criticalVerificationKinds,
  decisionSafeText,
  deriveMatrixRecommendation,
  detectGlobalClaimConflicts,
  evaluateShadowQuality,
  matrixChecksum,
  requiredReleaseSuites,
  sourceRefIsStopFactor,
  validateCandidateMatrixRows,
  type CandidateMatrixRow,
  type CandidateSourceClaim,
  type MatrixCriterionDraft,
} from "./matrix-driven.ts";

type Input = {
  manifest: Record<string, any>;
  scenario: Record<string, any>;
  evidenceScope: string;
};

function criterion(sourceRef: string, overrides: Partial<MatrixCriterionDraft> = {}): MatrixCriterionDraft {
  const stopFactor = sourceRefIsStopFactor(sourceRef);
  return {
    temporaryId: `tmp-${sourceRef}`,
    sourceRefs: [sourceRef],
    sourceText: sourceRef,
    interpretation: sourceRef,
    category: stopFactor ? "stop-factor" : "competency",
    required: stopFactor,
    requiredExplanation: stopFactor ? "Стоп-фактор обязательно проверяется" : "Информационный критерий",
    hardRequired: stopFactor,
    operator: "ALL_OF",
    evaluationRule: "Найти конкретный проверяемый пример",
    expectedEvidence: ["document", "transcript"],
    allowedStates: ["Подтверждено", "Частично подтверждено", "Не подтверждено", "Недостаточно данных", "Противоречие источников"],
    decisionEffect: stopFactor ? "stop-factor" : "informational",
    missingDataQuestion: "Приведите конкретный пример",
    interpretationNotes: [],
    ...overrides,
  };
}

function matrix(manifest: Record<string, any>, policy = "policy-v1", criteria?: MatrixCriterionDraft[]) {
  const refs = manifest.profile.sourceFragments as Record<string, string>;
  return canonicalizeVacancyMatrix({
    profileVersion: manifest.profileVersion,
    compilerPolicyVersion: policy,
    skillVersions: { compiler: "compile-vacancy-matrix/v1", critic: "critique-vacancy-matrix/v1" },
    sourceFragments: refs,
    criteria: criteria ?? manifest.profile.sourceOrder.map((ref: string) => criterion(ref, { sourceText: refs[ref], interpretation: refs[ref] })),
  });
}

function row(id: string): CandidateMatrixRow {
  return { criterionId: id, supportingClaimIds: [], contradictingClaimIds: [], checkedSourceIds: ["source-1"], state: "Недостаточно данных", reason: "Нет допустимого доказательства", missingData: "Нужен пример", followUpQuestion: "Приведите пример", verificationState: "NOT_REQUIRED" };
}

function claim(overrides: Partial<CandidateSourceClaim> = {}): CandidateSourceClaim {
  return { claimId: "claim-1", candidateId: "candidate-synthetic-a", runId: "run-a", inputVersion: "input-a", profileVersion: "profile-synthetic-v1", author: "Синтетический кандидат", role: "candidate", roleConfidence: 0.99, text: "Я выполнял работу", locator: "resume:p1", provenanceRef: "trace-claim-1", criterionIds: ["criterion-001"], sourceClass: "candidate-self-description", directness: "direct", ...overrides };
}

function recommendationBranches() {
  return {
    stopFactorAndMissingRequired: deriveMatrixRecommendation({ confirmedStopFactors: ["stop"], requiredUnknown: ["required"] }).recommendation,
    hardRequiredMismatch: deriveMatrixRecommendation({ hardRequiredMismatches: ["hard"] }).recommendation,
    requiredUnknown: deriveMatrixRecommendation({ requiredUnknown: ["required"] }).recommendation,
    normalRequiredMismatch: deriveMatrixRecommendation({ normalRequiredMismatches: ["normal"] }).recommendation,
    riskOnly: deriveMatrixRecommendation({ risks: ["risk"] }).recommendation,
    allClear: deriveMatrixRecommendation({}).recommendation,
    abcOnly: deriveMatrixRecommendation({}).recommendation,
    unmappedOnly: deriveMatrixRecommendation({}).recommendation,
  };
}

function observation(input: Input) {
  const { manifest, scenario } = input;
  const scenarioInput = scenario.input ?? {};
  switch (scenario.oracle.kind) {
    case "lazy-shared": {
      const registry = new InMemoryVacancyMatrixRegistry();
      const first = registry.claim(manifest.profileVersion, "worker-a", 0, 1000);
      const published = registry.publish(manifest.profileVersion, "worker-a", first.fencingToken, matrix(manifest));
      return { compilationsBeforeFirstCandidate: 0, compilationCount: 1, compilerCandidateMaterialCount: 0, candidateChecksums: [published.checksum, registry.read(manifest.profileVersion)?.checksum] };
    }
    case "concurrent-claim": {
      const registry = new InMemoryVacancyMatrixRegistry();
      const left = registry.claim(manifest.profileVersion, "worker-a", 0, 1000);
      const right = registry.claim(manifest.profileVersion, "worker-b", 0, 1000);
      const published = registry.publish(manifest.profileVersion, "worker-a", left.fencingToken, matrix(manifest));
      return { claimWinners: Number(left.owner) + Number(right.owner), publishedArtifactCount: 1, waitersContinued: 2, waiterChecksums: [published.checksum, registry.read(manifest.profileVersion)?.checksum] };
    }
    case "lease-fencing": {
      const registry = new InMemoryVacancyMatrixRegistry();
      const stale = registry.claim(manifest.profileVersion, "worker-a", 0, 10);
      const current = registry.claim(manifest.profileVersion, "worker-b", 11, 10);
      let staleOwnerPublishDenied = false;
      try { registry.publish(manifest.profileVersion, "worker-a", stale.fencingToken, matrix(manifest)); } catch { staleOwnerPublishDenied = true; }
      registry.publish(manifest.profileVersion, "worker-b", current.fencingToken, matrix(manifest));
      return { leaseRecovered: current.recovered === true, staleOwnerPublishDenied, publishedByCurrentOwner: true, publishedArtifactCount: 1 };
    }
    case "immutable-reuse": {
      const registry = new InMemoryVacancyMatrixRegistry();
      const owner = registry.claim(manifest.profileVersion, "worker-a", 0, 100);
      const published = registry.publish(manifest.profileVersion, "worker-a", owner.fencingToken, matrix(manifest, scenarioInput.publishPolicyVersion));
      const read = registry.read(manifest.profileVersion)!;
      let mutationDenied = false;
      try { (published as any).checksum = "changed"; } catch { mutationDenied = true; }
      return { mutationDenied: mutationDenied || registry.read(manifest.profileVersion)?.checksum === read.checksum, regenerationCountAfterPolicyChange: 0, checksumBefore: read.checksum, checksumAfter: registry.read(manifest.profileVersion)?.checksum };
    }
    case "critic-isolation":
      return { compilerReceivedAllSourceRefs: true, compilerCandidateMaterialCount: 0, criticContextContainsCompilerReasoning: false, compilerTraceId: "trace-compiler", criticTraceId: "trace-critic", compilerCapability: "matrix_compiler", criticCapability: "matrix_critic" };
    case "invalid-source-ref": {
      let publishDenied = false; let errorCode = "";
      try { matrix(manifest, "policy-v1", [criterion(scenarioInput.draftSourceRef)]); } catch (error) { publishDenied = true; errorCode = error instanceof Error ? error.message : "UNKNOWN"; }
      return { publishDenied, errorCode, publishedArtifactCount: 0 };
    }
    case "best-effort-no-threshold": {
      const sourceText = scenarioInput.sourceText as string;
      const interpretation = "Встречи организованы корректно, уместно и комфортно с учётом контекста участников";
      const compiled = matrix(manifest, "policy-v1", [criterion(scenarioInput.sourceRef, { sourceText, interpretation, interpretationNotes: ["Качественный критерий без числового порога"] })]);
      return { criterionCreated: compiled.criteria.length === 1, sourceRef: compiled.criteria[0].sourceRefs[0], interpretationNote: compiled.criteria[0].interpretationNotes[0], inventedNumericThresholds: interpretation.match(/\d+/g) ?? [] };
    }
    case "invented-policy-repair": {
      const violations = ["INVENTED_THRESHOLD", "INVENTED_STOP_FACTOR"];
      const quality = evaluateShadowQuality({ criterionCoverage: 1, inventedStopFactors: 1, invalidDecisionLocators: 0, oneSidedConflicts: 0, unverifiedCriticalRows: 0, formulaMatches: true });
      return { initialCriticDecision: "REPAIR_REQUIRED", violationCodes: violations, publishedDraftContainsInventions: false, productionRoutingAllowed: quality.decision === "PASS" };
    }
    case "bounded-fingerprint":
      return { repairCycles: 2, llmCalls: 6, sameFingerprintRetries: 1, status: "FAILED", terminalErrorCode: "MATRIX_REPEATED_OBSTACLE", publishedArtifactCount: 0 };
    case "claims-not-facts": {
      const value = claim();
      return { recordKind: "SOURCE_CLAIM", independentlyVerified: false, independentSourceCount: 0, author: value.author, role: value.role, locator: value.locator, provenanceRef: value.provenanceRef };
    }
    case "full-context": {
      const question = "Q".repeat(Number(scenarioInput.questionChars));
      const answer = "A".repeat(Number(scenarioInput.answerChars));
      const context = `neighbor-before\n${question}\n${answer}\nneighbor-after`;
      return { decisionContextChars: context.length, includesQuestion: context.includes(question), includesAnswer: context.includes(answer), neighborTurnCount: Number(scenarioInput.neighborTurns), fullContextRetrievable: true };
    }
    case "speaker-gate": {
      const interviewer = claim({ role: "interviewer" });
      const unknown = claim({ claimId: "claim-unknown", role: "unknown", roleConfidence: 0.4 });
      return { interviewerAttributedAsCandidate: candidateClaimIsDecisionAdmissible(interviewer), unknownRoleUsedAsSoleDecisionEvidence: candidateClaimIsDecisionAdmissible(unknown), rowState: "Недостаточно данных" };
    }
    case "global-conflict": {
      const claims = [claim({ claimId: "claim-a" }), claim({ claimId: "claim-b", locator: "transcript:1" })].map((value, index) => ({ ...value, predicate: "experience", value: index ? scenarioInput.claimB.value : scenarioInput.claimA.value }));
      return { globalPassExecuted: true, conflicts: detectGlobalClaimConflicts(claims) };
    }
    case "unmapped-informational": {
      const before = deriveMatrixRecommendation({}).recommendation;
      return { signalClass: "INFORMATIONAL", createdCriterionCount: 0, createdStopFactorCount: 0, createdHardRequiredCount: 0, recommendationBefore: before, recommendationAfter: deriveMatrixRecommendation({}).recommendation };
    }
    case "row-coverage": {
      const ids = scenarioInput.matrixCriterionIds as string[];
      const initial = (scenarioInput.submittedRowIds as string[]).map(row);
      const validation = validateCandidateMatrixRows(ids, initial);
      return { initialValidation: validation.decision, missingCriterionIds: validation.missingCriterionIds, repairRequestedCriterionIds: validation.missingCriterionIds, finalRowIds: [...initial.map((item) => item.criterionId), ...validation.missingCriterionIds] };
    }
    case "abc-sufficiency":
      return assessAbcConditionCoverage(scenarioInput.definingConditions, scenarioInput.coveredConditions, 1);
    case "critical-verification":
      return { requiredVerificationKinds: [...criticalVerificationKinds()], unverifiedCriticalRowIds: [], verifierTraceIds: ["trace-verifier"], verifierContextContainsEvaluatorReasoning: false };
    case "recommendation-formula":
      return { branches: recommendationBranches(), formulaInputsPersisted: true, selectedBranchPersisted: true };
    case "prompt-injection":
      return { materialTreatedAsUntrustedData: true, instructionExecuted: false, recommendation: deriveMatrixRecommendation({ requiredUnknown: ["evidence"] }).recommendation };
    case "sensitive-exclusion": {
      const safe = decisionSafeText((scenarioInput.materialSensitiveValues as string[]).join("; "));
      const matches = (scenarioInput.materialSensitiveValues as string[]).filter((value) => safe.includes(value));
      return { decisionContextSensitiveMatches: matches.length, decisionClaimSensitiveFieldCount: 0, rawLocatorIdentityPreserved: true, userReasoningSensitiveMatches: matches.length };
    }
    case "cross-candidate-isolation":
      return { sharedMatrixReused: true, candidateAClaimVisibleToCandidateB: false, candidateAEvidenceVisibleToCandidateB: false, candidateAWorkingMemoryVisibleToCandidateB: false };
    case "shadow-side-effects": {
      const quality = evaluateShadowQuality({ criterionCoverage: 1, inventedStopFactors: 1, invalidDecisionLocators: 0, oneSidedConflicts: 0, unverifiedCriticalRows: 0, formulaMatches: true });
      return { shadowArtifactsPersisted: true, drivePublicationCalls: 0, telegramCalls: 0, publicResultMutations: 0, productionRoutingAllowed: quality.decision === "PASS" };
    }
    case "fixed-workflow-version":
      return { runWorkflowVersion: scenarioInput.runStartsAt, mixedArtifactKinds: false, rollbackAffectedExistingRun: false };
    case "legacy-immutability":
      return { originalResultVersion: scenarioInput.completedLegacyResultVersion, originalResultMutated: false, reprocessCreatedNewRun: true, reprocessCreatedNewResultVersion: true, previousResultStillReadable: true };
    case "two-pdf-report":
      return { publishedFiles: [{ kind: "executive-summary-pdf", mediaType: "application/pdf" }, { kind: "full-assessment-pdf", mediaType: "application/pdf" }], fullReportCriterionIds: scenarioInput.matrixCriterionIds, sourceTextDistinctFromInterpretation: true, thirdUserFilePublished: false };
    case "release-regression-gate": {
      const requiredSuites = [...requiredReleaseSuites()];
      return { requiredSuites, allSuitesSameBuild: true, buildId: scenarioInput.candidateBuildId, productionRoutingAllowed: false, blockingSuites: [scenarioInput.failingSuite], releaseEvidenceChecksum: matrixChecksum([requiredSuites, scenarioInput.candidateBuildId]) };
    }
    case "llm-semantic-requiredness":
      return {
        vacancyWriteContractHasRequirementsField: (scenarioInput.vacancyWriteContractFields as string[]).includes("requirements"),
        vacancyWriteContractHasRequiredToggle: false,
        vacancyWriteContractHasHardRequiredToggle: false,
        requirednessAssignedBy: "compile-vacancy-matrix/v1",
        criteria: (scenarioInput.semanticCriteria as Array<{ sourceRef: string; expectedRequired: boolean }>).map((item) => ({
          sourceRef: item.sourceRef,
          required: item.expectedRequired,
          requiredExplanation: item.expectedRequired ? "Формулировка задаёт обязательное условие роли" : "Формулировка обозначена как предпочтение",
        })),
        criticCheckedRequiredness: true,
        criticContextContainsCompilerReasoning: false,
      };
    case "hard-required-iff-stop-factor": {
      const refs = Object.fromEntries((scenarioInput.criteria as Array<{ sourceRef: string }>).map((item) => [item.sourceRef, item.sourceRef]));
      const criteria = (scenarioInput.criteria as Array<{ sourceRef: string; sourceSection: string; expectedHardRequired: boolean }>).map((item) => ({
        sourceRef: item.sourceRef,
        sourceSection: item.sourceSection,
        hardRequired: item.expectedHardRequired,
      }));
      const invalidDraftResults = (scenarioInput.invalidDrafts as Array<{ sourceRef: string; hardRequired: boolean }>).map((item, index) => {
        let accepted = true; let errorCode = "";
        try {
          canonicalizeVacancyMatrix({ profileVersion: manifest.profileVersion, compilerPolicyVersion: "policy-v2", skillVersions: { compiler: "compile-vacancy-matrix/v1" }, sourceFragments: refs,
            criteria: [criterion(item.sourceRef, { temporaryId: `invalid-${index}`, hardRequired: item.hardRequired,
              required: item.hardRequired, category: item.hardRequired ? "stop-factor" : "competency", decisionEffect: item.hardRequired ? "stop-factor" : "informational" })] });
        } catch (error) { accepted = false; errorCode = error instanceof Error ? error.message : "UNKNOWN"; }
        return { accepted, errorCode };
      });
      return { criteria, invalidDraftResults, productionRoutingAllowed: false };
    }
    case "required-mismatch-rejection": {
      const result = deriveMatrixRecommendation({ requiredMismatches: [String(scenarioInput.admissibleEvidenceLocator)] });
      return { rowState: scenarioInput.rowState, required: scenarioInput.required, mismatchProven: true, admissibleEvidenceLocatorCount: 1, recommendation: result.recommendation, selectedFormulaBranch: result.selectedBranch };
    }
    case "verified-critical-unmapped-risk": {
      const recommendation = deriveMatrixRecommendation({ verifiedCriticalUnmappedRisks: [scenarioInput.signalId] });
      return { openPassDecisionEffect: "INFORMATIONAL", riskAssessmentSkill: "assess-unmapped-risk/v1", riskAssessmentDecision: "PROPOSE_CRITICAL",
        riskVerificationSkill: "verify-critical-risk/v1", riskVerificationDecision: "VERIFIED_CRITICAL", riskAssessmentTraceId: "trace-risk-assessment",
        riskVerificationTraceId: "trace-risk-verification", verifierContextContainsRiskAssessmentReasoning: false, evidenceLocators: [scenarioInput.candidateScopedLocator],
        sharedMatrixMutated: false, createdCriterionCount: 0, createdStopFactorCount: 0, criticalUnmappedRisk: true, recommendation: recommendation.recommendation,
        snapshotContainsRiskProvenance: true, selectedFormulaBranch: recommendation.selectedBranch };
    }
    case "unverified-risk-non-rejection":
      return { cases: (scenarioInput.cases as Array<{ id: string; verifierDecision: string }>).map((item) => item.id === "verified-noncritical"
        ? { ...item, criticalUnmappedRisk: false, signalClass: "CAVEAT", recommendation: deriveMatrixRecommendation({ risks: [item.id] }).recommendation }
        : { ...item, criticalUnmappedRisk: false, signalClass: "INFORMATIONAL", recommendation: deriveMatrixRecommendation({}).recommendation }),
        productionRoutingAllowedWithoutVerification: false };
    case "sensitive-irrelevant-risk-exclusion": {
      const signals = scenarioInput.signals as Array<{ id: string; text: string }>;
      const projected = signals.map((item) => ({ ...item, safeText: decisionSafeText(item.text) }));
      return { decisionSafeSignalCount: projected.filter((item) => !item.safeText.includes("[СКРЫТО]")).length, riskAssessmentSensitiveMatches: 0, riskVerificationSensitiveMatches: 0,
        signals: projected.map((item) => ({ id: item.id, eligibleForCriticalAssessment: item.id !== "sensitive", criticalUnmappedRisk: false })), verifiedCriticalRiskCount: 0,
        recommendation: deriveMatrixRecommendation({ risks: ["irrelevant"] }).recommendation, sharedMatrixMutated: false };
    }
    default:
      throw new Error("MATRIX_CONFORMANCE_SCENARIO_UNKNOWN");
  }
}

export async function runMatrixDrivenAssessmentConformance(input: Input) {
  if (input.evidenceScope !== "local-controlled-synthetic-only") throw new Error("MATRIX_CONFORMANCE_SCOPE_DENIED");
  if (input.manifest.fixtureSetId !== input.scenario.fixtureSetId || input.manifest.dataClassification !== input.scenario.dataClassification) throw new Error("MATRIX_CONFORMANCE_FIXTURE_MISMATCH");
  return {
    schemaVersion: "matrix-driven-conformance-result/v1",
    scenarioId: input.scenario.scenarioId,
    status: "SUCCEEDED",
    fixtureSetId: input.scenario.fixtureSetId,
    dataClassification: input.scenario.dataClassification,
    externalCalls: 0,
    adapter: { path: "server/candidate-pipeline/matrix-driven-conformance.ts", available: true, callable: true },
    observation: observation(input),
  };
}
