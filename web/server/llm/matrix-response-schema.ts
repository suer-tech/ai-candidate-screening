import type { SchemaArtifact } from "./artifacts.ts";
import { artifactHash, deepFreeze, type JsonValue } from "./value-utils.ts";

export function matrixResponseSchemaForProfile(
  capability: string,
  artifact: SchemaArtifact,
  context: JsonValue,
): SchemaArtifact {
  if (capability === "abc_matrix_assessment" && context && typeof context === "object" && !Array.isArray(context)) {
    const directions = context.directions;
    if (!Array.isArray(directions) || !directions.length) return artifact;
    const directionIds = directions.map((direction) => direction && typeof direction === "object" && !Array.isArray(direction) ? direction.id : undefined);
    if (directionIds.some((id) => typeof id !== "string" || !id.trim()) || new Set(directionIds).size !== directionIds.length) {
      throw new Error("ABC_DIRECTION_SCHEMA_INPUT_INVALID");
    }
    const schema = structuredClone(artifact.schema) as Record<string, any>;
    const outputDirections = schema.properties?.directions;
    const directionId = outputDirections?.items?.properties?.directionId;
    if (!outputDirections || !directionId) throw new Error("ABC_DIRECTION_SCHEMA_INVALID");
    outputDirections.minItems = directionIds.length;
    outputDirections.maxItems = directionIds.length;
    if (directionIds.length === 1) directionId.const = directionIds[0];
    else directionId.enum = directionIds;
    return deepFreeze({ ...artifact, schema, hash: artifactHash(schema) });
  }
  if (capability !== "matrix_compiler" && capability !== "matrix_critic") return artifact;
  if (!context || typeof context !== "object" || Array.isArray(context)) return artifact;
  const fragments = context.sourceFragments;
  if (!fragments || typeof fragments !== "object" || Array.isArray(fragments)) return artifact;
  const sourceRefs = Object.entries(fragments)
    .filter(([key, value]) => key.trim() && typeof value === "string" && value.trim())
    .map(([key]) => key).sort();
  if (!sourceRefs.length) return artifact;
  const schema = structuredClone(artifact.schema) as Record<string, any>;
  const item = schema.$defs?.criterion?.properties?.sourceRefs?.items;
  if (!item || typeof item !== "object") throw new Error("MATRIX_RESPONSE_SCHEMA_INVALID");
  item.enum = sourceRefs;
  return deepFreeze({ ...artifact, schema, hash: artifactHash(schema) });
}
