export const MATRIX_CAPABILITY_SCHEMAS = {
  matrix_compiler: "vacancy-matrix-draft/v1",
  matrix_critic: "vacancy-matrix-critic/v2",
  criterion_claim_extraction: "candidate-claims/v1",
  unmapped_signal_discovery: "candidate-unmapped-signals/v1",
  unmapped_risk_assessment: "candidate-unmapped-risk-assessment/v1",
  critical_risk_verification: "candidate-critical-risk-verification/v1",
  evidence_consolidation: "candidate-evidence-consolidation/v1",
  global_conflict_detection: "candidate-global-conflicts/v1",
  matrix_row_evaluation: "candidate-matrix-rows/v2",
  abc_matrix_assessment: "candidate-abc-matrix/v1",
  critical_row_verification: "candidate-row-verification/v1",
  invalid_row_repair: "candidate-matrix-rows/v1",
} as const;

export type MatrixCapability = keyof typeof MATRIX_CAPABILITY_SCHEMAS;

export class UnsupportedMatrixSchemaError extends Error {
  constructor(readonly capability: MatrixCapability, readonly version: string) {
    super(`UNSUPPORTED_MATRIX_SCHEMA_VERSION:${capability}:${version}`);
    this.name = "UnsupportedMatrixSchemaError";
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function array(value: unknown, key: string) {
  if (!Array.isArray(value)) throw new Error(`INVALID_MATRIX_STRUCTURED_OUTPUT:${key}`);
}

export function normalizeMatrixCapabilityOutput(capability: MatrixCapability, input: unknown) {
  if (!object(input)) throw new Error("INVALID_MATRIX_STRUCTURED_OUTPUT");
  const source = structuredClone(input);
  const version = typeof source.schemaVersion === "string" ? source.schemaVersion : "missing";
  if (version !== MATRIX_CAPABILITY_SCHEMAS[capability]) throw new UnsupportedMatrixSchemaError(capability, version);
  switch (capability) {
    case "matrix_compiler": array(source.criteria, "criteria"); break;
    case "matrix_critic":
      if (!new Set(["PASS", "CORRECTED"]).has(String(source.decision))) throw new Error("INVALID_MATRIX_STRUCTURED_OUTPUT:decision");
      array(source.changes, "changes");
      if (!object(source.successor)) throw new Error("INVALID_MATRIX_STRUCTURED_OUTPUT:successor");
      if (source.successor.schemaVersion !== "vacancy-matrix-draft/v1") throw new Error("INVALID_MATRIX_STRUCTURED_OUTPUT:successor.schemaVersion");
      array(source.successor.criteria, "successor.criteria");
      break;
    case "criterion_claim_extraction": array(source.claims, "claims"); array(source.coverage, "coverage"); break;
    case "unmapped_signal_discovery": array(source.signals, "signals"); break;
    case "unmapped_risk_assessment": array(source.proposals, "proposals"); break;
    case "critical_risk_verification": array(source.results, "results"); break;
    case "evidence_consolidation": array(source.claimGroups, "claimGroups"); break;
    case "global_conflict_detection": array(source.conflicts, "conflicts"); break;
    case "matrix_row_evaluation": case "invalid_row_repair":
      array(source.rows, "rows");
      if (!new Set(["Рекомендовать", "Рекомендовать с оговорками", "Не рекомендовать", "Недостаточно данных"]).has(String(source.recommendation))) throw new Error("INVALID_MATRIX_STRUCTURED_OUTPUT:recommendation");
      if (typeof source.recommendationReason !== "string" || !source.recommendationReason.trim()) throw new Error("INVALID_MATRIX_STRUCTURED_OUTPUT:recommendationReason");
      break;
    case "abc_matrix_assessment": array(source.directions, "directions"); break;
    case "critical_row_verification": array(source.results, "results"); break;
  }
  return Object.freeze(source);
}
