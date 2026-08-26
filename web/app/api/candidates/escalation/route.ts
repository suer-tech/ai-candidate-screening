import { RuntimeConflictError } from "../../../../server/agent-runtime/runtime.ts";
import { requestPrincipal } from "../../../../server/auth/request-principal.ts";

const headers = { "cache-control": "private, no-store" };

export async function POST(request: Request) {
  const actor = await requestPrincipal(request);
  if (!actor) return Response.json({ error: "Требуется авторизация" }, { status: 401, headers });
  try {
    const body = await request.json() as { escalationId: string; expectedVersion: number; action: string; newInputVersion?: string; newProfileVersion?: string };
    if (!body.escalationId?.trim() || !Number.isInteger(body.expectedVersion) || !body.action?.trim()) return Response.json({ error: "Некорректное действие escalation" }, { status: 400, headers });
    const { agentRuntimeRepository } = await import("../../../../server/agent-runtime/runtime-bindings.ts");
    return Response.json(await (await agentRuntimeRepository()).resolveEscalation({ ...body, actor }), { headers });
  } catch (error) {
    const code = error instanceof RuntimeConflictError ? error.code : "ESCALATION_RESOLUTION_REJECTED";
    return Response.json({ error: code }, { status: error instanceof RuntimeConflictError ? 409 : 422, headers });
  }
}
