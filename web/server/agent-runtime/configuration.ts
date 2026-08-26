import { emptyUsage, type BudgetKind, type BudgetLimits } from "./types.ts";

export type AgentRuntimeConfiguration = {
  version: string;
  budgets: BudgetLimits;
  leaseMs: number;
  pollingMs: number;
  heartbeatMs: number;
  flags: { synthetic: boolean; shadow: boolean; acceptNewGoals: boolean; toolRouting: Record<string, "legacy" | "agent"> };
};

export function validateAgentRuntimeConfiguration(value: unknown): AgentRuntimeConfiguration {
  if (!value || typeof value !== "object") throw new Error("AGENT_RUNTIME_CONFIG_REQUIRED");
  const config = value as Partial<AgentRuntimeConfiguration>;
  if (!config.version?.trim() || !config.budgets || !config.flags) throw new Error("AGENT_RUNTIME_CONFIG_INCOMPLETE");
  for (const kind of Object.keys(emptyUsage()) as BudgetKind[]) {
    if (!Number.isFinite(config.budgets[kind]) || config.budgets[kind] <= 0) throw new Error(`AGENT_RUNTIME_BUDGET_INVALID:${kind}`);
  }
  for (const [name, amount] of Object.entries({ leaseMs: config.leaseMs, pollingMs: config.pollingMs, heartbeatMs: config.heartbeatMs })) {
    if (!Number.isInteger(amount) || Number(amount) <= 0) throw new Error(`AGENT_RUNTIME_CADENCE_INVALID:${name}`);
  }
  if (config.heartbeatMs! >= config.leaseMs!) throw new Error("AGENT_RUNTIME_HEARTBEAT_MUST_PRECEDE_LEASE_EXPIRY");
  for (const route of Object.values(config.flags.toolRouting)) if (!(["legacy", "agent"] as const).includes(route)) throw new Error("AGENT_RUNTIME_TOOL_ROUTE_INVALID");
  return structuredClone(config as AgentRuntimeConfiguration);
}

export function parseAgentRuntimeConfiguration(serialized: string | undefined) {
  if (!serialized?.trim()) throw new Error("AGENT_RUNTIME_CONFIG_REQUIRED");
  return validateAgentRuntimeConfiguration(JSON.parse(serialized));
}
