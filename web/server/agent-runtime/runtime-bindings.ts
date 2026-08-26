import { serverContainer } from "../configuration/container.ts";
import { PostgresAgentRuntimeRepository } from "./postgres-runtime-repository.ts";

export async function agentRuntimeRepository() { return new PostgresAgentRuntimeRepository((await serverContainer()).sql); }
export async function authorizeInternalRuntimeRequest(request: Request) {
  const configured = (await serverContainer()).environment.AGENT_RUNTIME_INTERNAL_TOKEN ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!configured || !supplied || configured.length !== supplied.length) return false;
  let difference = 0; for (let index = 0; index < configured.length; index += 1) difference |= configured.charCodeAt(index) ^ supplied.charCodeAt(index); return difference === 0;
}
