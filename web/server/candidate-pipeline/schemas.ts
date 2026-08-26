export type CandidateCapability = "ocr" | "speaker_mapping" | "fact_extraction" | "assessment" | "validation_repair";

const CURRENT: Record<CandidateCapability, string> = {
  ocr: "ocr-page/v1",
  speaker_mapping: "speaker-map/v1",
  fact_extraction: "facts/v1",
  assessment: "assessment/v1",
  validation_repair: "bounded-repair/v1",
};

const requiredKeys: Record<CandidateCapability, readonly string[]> = {
  ocr: ["page", "text", "confidence", "regions"],
  speaker_mapping: ["mappings"],
  fact_extraction: ["facts", "conflicts"],
  assessment: ["observations", "abcStates", "abcEvidence", "competencies", "accessToKe", "risks", "stopFactors"],
  validation_repair: ["successor", "addressedViolationIds"],
};

export class UnsupportedCandidateSchemaError extends Error {
  constructor(readonly capability: CandidateCapability, readonly version: string) {
    super(`UNSUPPORTED_SCHEMA_VERSION:${capability}:${version}`);
    this.name = "UnsupportedCandidateSchemaError";
  }
}

export function normalizeCandidateCapabilityOutput(capability: CandidateCapability, input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("INVALID_STRUCTURED_OUTPUT");
  const source = structuredClone(input) as Record<string, unknown>;
  const version = typeof source.schemaVersion === "string" ? source.schemaVersion : "missing";
  if (capability === "speaker_mapping" && version === "speaker-map/v0") {
    const roles = Array.isArray(source.roles) ? source.roles : [];
    return validate(capability, { schemaVersion: "speaker-map/v1", mappings: roles, migration: { from: "speaker-map/v0", adapter: "speaker-map-v0-to-v1" } });
  }
  if (version !== CURRENT[capability]) throw new UnsupportedCandidateSchemaError(capability, version);
  if (capability === "assessment") {
    source.abcStates = keyedAssessmentTransport(source.abcStates, "state", "abcStates");
    source.abcEvidence = keyedAssessmentTransport(source.abcEvidence, undefined, "abcEvidence");
  }
  return validate(capability, source);
}

function keyedAssessmentTransport(value: unknown, valueKey: string | undefined, path: string): unknown {
  if (!Array.isArray(value)) return value;
  const result: Record<string, unknown> = {};
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`INVALID_STRUCTURED_OUTPUT:assessment:${path}`);
    const source = item as Record<string, unknown>;
    const directionId = typeof source.directionId === "string" ? source.directionId.trim() : "";
    if (!directionId || Object.prototype.hasOwnProperty.call(result, directionId)) throw new Error(`INVALID_STRUCTURED_OUTPUT:assessment:${path}`);
    if (valueKey) result[directionId] = source[valueKey];
    else {
      const { directionId: _directionId, ...rest } = source;
      result[directionId] = rest;
    }
  }
  return result;
}

function validate(capability: CandidateCapability, source: Record<string, unknown>) {
  const missing = requiredKeys[capability].filter((key) => source[key] === undefined);
  if (missing.length) throw new Error(`INVALID_STRUCTURED_OUTPUT:${capability}:missing:${missing.join(",")}`);
  if (capability === "ocr") {
    if (!Number.isInteger(source.page) || (source.page as number) < 1 || typeof source.text !== "string" || typeof source.confidence !== "number" || source.confidence < 0 || source.confidence > 1 || !Array.isArray(source.regions)) throw new Error("INVALID_STRUCTURED_OUTPUT:ocr");
  }
  for (const key of ["mappings", "facts", "conflicts", "observations", "competencies", "accessToKe", "risks", "stopFactors", "addressedViolationIds"]) {
    if (source[key] !== undefined && !Array.isArray(source[key])) throw new Error(`INVALID_STRUCTURED_OUTPUT:${capability}:${key}`);
  }
  if (source.abcStates !== undefined && (!source.abcStates || typeof source.abcStates !== "object" || Array.isArray(source.abcStates))) throw new Error("INVALID_STRUCTURED_OUTPUT:assessment:abcStates");
  if (capability === "assessment") validateAssessmentShape(source);
  return Object.freeze(source);
}

const ASSESSMENT_STATES = new Set(["Подтверждено", "Частично подтверждено", "Не подтверждено", "Недостаточно данных", "Противоречие источников"]);
const ABC_GRADES = new Set(["A", "B", "C", "CONFLICT", "Недостаточно данных"]);

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim());
}

function canonicalItems(source: Record<string, unknown>, key: "competencies" | "accessToKe" | "risks" | "stopFactors") {
  const values = source[key];
  if (!Array.isArray(values) || values.some((value) => !object(value)
    || typeof value.name !== "string" || !value.name.trim()
    || (key === "accessToKe" && typeof value.required !== "boolean")
    || !ASSESSMENT_STATES.has(String(value.state))
    || typeof value.reason !== "string" || !value.reason.trim()
    || !stringArray(value.factIds))) throw new Error(`INVALID_STRUCTURED_OUTPUT:assessment:${key}`);
}

function validateAssessmentShape(source: Record<string, unknown>) {
  const observations = source.observations;
  if (!Array.isArray(observations) || observations.some((value) => !object(value)
    || typeof value.criterion !== "string" || !value.criterion.trim()
    || typeof value.category !== "string" || !value.category.trim()
    || typeof value.required !== "boolean"
    || !ASSESSMENT_STATES.has(String(value.state))
    || typeof value.reason !== "string" || !value.reason.trim()
    || !stringArray(value.factIds))) throw new Error("INVALID_STRUCTURED_OUTPUT:assessment:observations");
  for (const key of ["competencies", "accessToKe", "risks", "stopFactors"] as const) canonicalItems(source, key);
  const states = source.abcStates as Record<string, unknown>;
  if (Object.values(states).some((grade) => !ABC_GRADES.has(String(grade)))) throw new Error("INVALID_STRUCTURED_OUTPUT:assessment:abcStates");
  if (!object(source.abcEvidence)) throw new Error("INVALID_STRUCTURED_OUTPUT:assessment:abcEvidence");
  const evidence = source.abcEvidence as Record<string, unknown>;
  if (Object.keys(evidence).some((direction) => !(direction in states))) {
    throw new Error("INVALID_STRUCTURED_OUTPUT:assessment:abcEvidence");
  }
  if (Object.keys(states).some((direction) => {
    const basis = evidence[direction];
    if (!object(basis) || !stringArray(basis.factIds) || typeof basis.reason !== "string" || !basis.reason.trim() || !object(basis.levels)) return true;
    return ["A", "B", "C"].some((grade) => {
      const level = (basis.levels as Record<string, unknown>)[grade];
      return !object(level) || typeof level.definition !== "string" || !level.definition.trim() || !stringArray(level.matchedConditions) || !stringArray(level.missingConditions) || !stringArray(level.contradictingFactIds);
    });
  })) throw new Error("INVALID_STRUCTURED_OUTPUT:assessment:abcEvidence");
}
