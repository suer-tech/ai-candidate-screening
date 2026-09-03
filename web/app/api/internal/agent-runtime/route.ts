import { RuntimeConflictError } from "../../../../server/agent-runtime/runtime.ts";

const headers = { "cache-control": "private, no-store" };

export async function POST(request: Request) {
  const { agentRuntimeRepository, authorizeInternalRuntimeRequest } = await import("../../../../server/agent-runtime/runtime-bindings.ts");
  if (!await authorizeInternalRuntimeRequest(request)) return Response.json({ error: "INTERNAL_RUNTIME_UNAUTHORIZED" }, { status: 401, headers });
  try {
    const body = await request.json() as { command: string; [key: string]: unknown };
    const repository = await agentRuntimeRepository();
    switch (body.command) {
      case "create-goal": return Response.json(await repository.createGoal(body.input as Parameters<typeof repository.createGoal>[0]), { headers });
      case "publish": return Response.json(await repository.publishTrigger(body.input as Parameters<typeof repository.publishTrigger>[0]), { headers });
      case "promote": return Response.json({ taskIds: await repository.promote(String(body.runId)) }, { headers });
      case "claim": return Response.json({ task: await repository.claim(body.input as Parameters<typeof repository.claim>[0]) }, { headers });
      case "claim-task": return Response.json({ task: await repository.claimById(body.input as Parameters<typeof repository.claimById>[0]) }, { headers });
      case "recover": return Response.json({ taskIds: await repository.recoverStale(Number(body.now ?? Date.now())) }, { headers });
      case "reconcile-dispatch": return Response.json({ taskIds: await repository.reconcileDispatch(Number(body.now ?? Date.now()), typeof body.republishAfterMs === "number" ? body.republishAfterMs : undefined) }, { headers });
      case "defer-dispatch": return Response.json({ accepted: await repository.deferPublishedDispatch(body.input as Parameters<typeof repository.deferPublishedDispatch>[0]) }, { headers });
      case "dispatch-stats": return Response.json(await repository.dispatchStats(Number(body.now ?? Date.now())), { headers });
      case "authorize": return Response.json(await repository.authorizeTool(body.input as Parameters<typeof repository.authorizeTool>[0]), { headers });
      case "prepare-effect": return Response.json(await repository.prepareExternalEffect(body.input as Parameters<typeof repository.prepareExternalEffect>[0]), { headers });
      case "wait-for-human": return Response.json(await repository.waitForHuman(body.input as Parameters<typeof repository.waitForHuman>[0]), { headers });
      case "issue-grant": return Response.json(await repository.issueGrant(body.input as Parameters<typeof repository.issueGrant>[0]), { headers });
      case "revoke-grant": await repository.revokeGrant(String(body.grantId), Number(body.revokedAt ?? Date.now())); return Response.json({ accepted: true }, { headers });
      case "heartbeat": await repository.heartbeat(body.input as Parameters<typeof repository.heartbeat>[0]); return Response.json({ accepted: true }, { headers });
      case "checkpoint": await repository.checkpoint(body.input as Parameters<typeof repository.checkpoint>[0]); return Response.json({ accepted: true }, { headers });
      case "complete": await repository.outcome({ ...(body.input as Omit<Parameters<typeof repository.outcome>[0], "outcome">), outcome: "SUCCEEDED" }); return Response.json({ accepted: true }, { headers });
      case "defer": await repository.defer(body.input as Parameters<typeof repository.defer>[0]); return Response.json({ accepted: true }, { headers });
      case "fail": await repository.outcome({ ...(body.input as Omit<Parameters<typeof repository.outcome>[0], "outcome">), outcome: "FAILED" }); return Response.json({ accepted: true }, { headers });
      case "unknown": await repository.outcome({ ...(body.input as Omit<Parameters<typeof repository.outcome>[0], "outcome">), outcome: "UNKNOWN_OUTCOME" }); return Response.json({ accepted: true }, { headers });
      case "timeline": return Response.json(await repository.timeline(String(body.runId)), { headers });
      case "projection": return Response.json(await repository.projection(String(body.runId)), { headers });
      default: return Response.json({ error: "UNSUPPORTED_RUNTIME_COMMAND" }, { status: 400, headers });
    }
  } catch (error) {
    const status = error instanceof RuntimeConflictError ? 409 : 422;
    return Response.json({ error: error instanceof Error ? error.message : "RUNTIME_COMMAND_REJECTED" }, { status, headers });
  }
}
