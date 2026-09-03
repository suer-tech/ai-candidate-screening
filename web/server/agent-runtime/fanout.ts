import { createHash } from "node:crypto";

export type FanoutShardDescriptor = {
  identity: string;
  ordinal: number;
  required?: boolean;
  payload?: Record<string, unknown>;
  toolKey?: string;
  dependsOn?: readonly string[];
};
export type FanoutDescriptor = {
  schemaVersion: "candidate-fanout-descriptor/v1";
  workflowVersion: string;
  runId: string;
  planVersion: number;
  groupKey: string;
  kind: string;
  inputFingerprint: string;
  profileFingerprint: string;
  configFingerprint: string;
  shards: readonly FanoutShardDescriptor[];
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function fanoutFingerprint(descriptor: FanoutDescriptor) {
  return createHash("sha256").update(stable(descriptor)).digest("hex");
}

export function fanoutRecoveryFingerprint(descriptor: FanoutDescriptor) {
  const { runId: _runId, planVersion: _planVersion, ...stableDescriptor } = descriptor;
  return createHash("sha256").update(stable(stableDescriptor)).digest("hex");
}

export function createFanoutDescriptor(input: Omit<FanoutDescriptor, "schemaVersion" | "shards"> & { shards: readonly Omit<FanoutShardDescriptor, "ordinal">[] }): FanoutDescriptor {
  const identities = new Set<string>();
  const shards = [...input.shards].sort((a, b) => a.identity.localeCompare(b.identity)).map((shard, ordinal) => {
    if (!shard.identity.trim() || identities.has(shard.identity)) throw new Error("FANOUT_SHARD_IDENTITY_INVALID");
    identities.add(shard.identity);
    if (shard.dependsOn?.some((identity) => !identity.trim() || identity === shard.identity)) throw new Error("FANOUT_SHARD_DEPENDENCY_INVALID");
    return { ...structuredClone(shard), ordinal, required: shard.required !== false };
  });
  for (const shard of shards) for (const dependency of shard.dependsOn ?? []) {
    if (!identities.has(dependency)) throw new Error("FANOUT_SHARD_DEPENDENCY_UNKNOWN");
  }
  return { schemaVersion: "candidate-fanout-descriptor/v1", ...structuredClone(input), shards };
}

export function fanoutGroupId(descriptor: FanoutDescriptor) {
  return `fanout-${fanoutFingerprint(descriptor).slice(0, 32)}`;
}

export function fanoutShardTaskId(groupId: string, identity: string) {
  return `${groupId}:shard:${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

export function canonicalJoin<T extends { shardIdentity: string }>(expected: readonly FanoutShardDescriptor[], results: readonly T[]): T[] {
  const byIdentity = new Map<string, T>();
  for (const result of results) {
    if (byIdentity.has(result.shardIdentity)) throw new Error("FANOUT_DUPLICATE_SHARD_RESULT");
    byIdentity.set(result.shardIdentity, result);
  }
  for (const shard of expected) if (shard.required !== false && !byIdentity.has(shard.identity)) throw new Error("FANOUT_REQUIRED_SHARD_MISSING");
  for (const identity of byIdentity.keys()) if (!expected.some((shard) => shard.identity === identity)) throw new Error("FANOUT_UNKNOWN_SHARD_RESULT");
  return expected.flatMap((shard) => byIdentity.has(shard.identity) ? [byIdentity.get(shard.identity)!] : []);
}
