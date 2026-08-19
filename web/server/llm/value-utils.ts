import { createHash } from "node:crypto";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

export function immutableJson<T extends JsonValue>(value: T): Readonly<T> {
  return deepFreeze(cloneJson(value));
}

export function artifactHash(value: JsonValue | string): string {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return `sha256:${createHash("sha256").update(serialized).digest("hex")}`;
}
