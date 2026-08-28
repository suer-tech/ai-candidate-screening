export type CandidateCapability = "ocr" | "speaker_mapping";

const CURRENT: Record<CandidateCapability, string> = {
  ocr: "ocr-page/v1",
  speaker_mapping: "speaker-map/v1",
};

const requiredKeys: Record<CandidateCapability, readonly string[]> = {
  ocr: ["page", "text", "confidence", "regions"],
  speaker_mapping: ["mappings"],
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
  return validate(capability, source);
}

function validate(capability: CandidateCapability, source: Record<string, unknown>) {
  const missing = requiredKeys[capability].filter((key) => source[key] === undefined);
  if (missing.length) throw new Error(`INVALID_STRUCTURED_OUTPUT:${capability}:missing:${missing.join(",")}`);
  if (capability === "ocr") {
    if (!Number.isInteger(source.page) || (source.page as number) < 1 || typeof source.text !== "string" || typeof source.confidence !== "number" || source.confidence < 0 || source.confidence > 1 || !Array.isArray(source.regions)) throw new Error("INVALID_STRUCTURED_OUTPUT:ocr");
  }
  for (const key of ["mappings"]) {
    if (source[key] !== undefined && !Array.isArray(source[key])) throw new Error(`INVALID_STRUCTURED_OUTPUT:${capability}:${key}`);
  }
  return Object.freeze(source);
}
