import { serverContainer } from "../configuration/container.ts";
import { PostgresAgentRuntimeRepository } from "../agent-runtime/postgres-runtime-repository.ts";
import { createGoogleDriveOAuthRuntime } from "./runtime.ts";

export async function googleDriveOAuthRuntime() {
  const container = await serverContainer();
  const runtime = new PostgresAgentRuntimeRepository(container.sql);
  return createGoogleDriveOAuthRuntime({ database: container.sql, environment: container.environment,
    resumeRuns: async (connectionId, ownerSubject) => { await runtime.resumeGoogleDriveRuns({ connectionId, ownerSubject, now: Date.now() }); } });
}
