import type { SchemaArtifact } from "./artifacts.ts";
import type { JsonValue } from "./value-utils.ts";

const ALLOWED_KEYWORDS = new Set([
  "$defs", "$ref", "additionalProperties", "anyOf", "const", "description", "enum", "items",
  "maxItems", "maxLength", "maximum", "minItems", "minLength", "minimum", "oneOf", "pattern",
  "properties", "required", "type", "uniqueItems",
]);

function object(value: unknown): Record<string, JsonValue> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, JsonValue> : null;
}

function nodeTypes(node: Record<string, JsonValue>): string[] {
  return Array.isArray(node.type)
    ? node.type.filter((value): value is string => typeof value === "string")
    : typeof node.type === "string" ? [node.type] : [];
}

function inspect(nodeValue: unknown, path: string, errors: string[]) {
  const node = object(nodeValue);
  if (!node) {
    errors.push(`${path} must be a JSON Schema object`);
    return;
  }
  for (const keyword of Object.keys(node)) {
    if (!ALLOWED_KEYWORDS.has(keyword)) errors.push(`${path}.${keyword} is not supported by strict Structured Outputs`);
  }

  const types = nodeTypes(node);
  if (types.includes("object") || node.properties !== undefined) {
    const properties = object(node.properties);
    if (!properties) errors.push(`${path}.properties must be an object`);
    if (node.additionalProperties !== false) errors.push(`${path} must set additionalProperties=false (open object is forbidden)`);
    const required = Array.isArray(node.required) && node.required.every((item) => typeof item === "string")
      ? node.required as string[] : null;
    if (!required) errors.push(`${path}.required must list every property`);
    if (properties && required) {
      const propertyKeys = Object.keys(properties).sort();
      const requiredKeys = [...new Set(required)].sort();
      if (JSON.stringify(propertyKeys) !== JSON.stringify(requiredKeys)) errors.push(`${path}.required must contain exactly every declared property`);
      for (const [key, child] of Object.entries(properties)) inspect(child, `${path}.properties.${key}`, errors);
    }
  } else if (node.additionalProperties !== undefined) {
    errors.push(`${path}.additionalProperties is only valid for a closed object schema`);
  }

  if (types.includes("array") || node.items !== undefined) {
    if (!object(node.items)) errors.push(`${path}.items must constrain every array item`);
    else inspect(node.items, `${path}.items`, errors);
  }
  for (const keyword of ["anyOf", "oneOf"] as const) {
    if (node[keyword] !== undefined) {
      if (!Array.isArray(node[keyword]) || node[keyword].length === 0) errors.push(`${path}.${keyword} must be a non-empty array`);
      else node[keyword].forEach((child, index) => inspect(child, `${path}.${keyword}[${index}]`, errors));
    }
  }
  if (node.$defs !== undefined) {
    const definitions = object(node.$defs);
    if (!definitions) errors.push(`${path}.$defs must be an object`);
    else for (const [key, child] of Object.entries(definitions)) inspect(child, `${path}.$defs.${key}`, errors);
  }
}

export function strictSchemaErrors(schema: unknown): readonly string[] {
  const errors: string[] = [];
  inspect(schema, "schema", errors);
  return errors;
}

export function assertStrictResponseSchema(artifact: Pick<SchemaArtifact, "id" | "version" | "schema">): void {
  const errors = strictSchemaErrors(artifact.schema);
  if (errors.length) throw new Error(`response schema ${artifact.id}/${artifact.version} is not strict-compatible: ${errors[0]}`);
}
