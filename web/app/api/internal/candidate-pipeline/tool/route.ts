import { serverContainer } from "../../../../../server/configuration/container.ts";
import { authorizeCandidateToolRequest, candidateToolErrorCode, executeCandidateTool } from "../../../../../server/candidate-pipeline/tool-executor.ts";
import { createProductionCandidateToolExecution } from "../../../../../server/candidate-pipeline/production-runtime.ts";
import { candidateToolRequiresLeaseSignal, createTaskExecutionSignal, type TaskExecutionSignal } from "../../../../../server/candidate-pipeline/task-execution-signal.ts";

const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };

export async function POST(request: Request) {
  const container = await serverContainer();
  const env = container.environment;
  const token = typeof env.CANDIDATE_TOOL_INTERNAL_TOKEN === "string" ? env.CANDIDATE_TOOL_INTERNAL_TOKEN : undefined;
  if (!authorizeCandidateToolRequest(request.headers.get("authorization"), token)) return Response.json({ outcome: "FAILED", errorCode: "TOOL_EXECUTOR_UNAUTHORIZED" }, { status: 401, headers });
  let execution: TaskExecutionSignal | undefined;
  try {
    const body = await request.json() as { toolKey?: string; task?: Record<string, unknown> };
    if (!body.toolKey || !body.task || typeof body.task.id !== "string") return Response.json({ outcome: "FAILED", errorCode: "TOOL_EXECUTOR_INPUT_INVALID" }, { status: 422, headers });
    if (candidateToolRequiresLeaseSignal(body.toolKey)) execution = await createTaskExecutionSignal(container.sql, { ...body.task, toolKey: body.toolKey }, request.signal);
    const signal = execution?.signal ?? request.signal;
    signal.throwIfAborted();
    const production = await createProductionCandidateToolExecution({ database: container.sql, environment: env, task: body.task, signal });
    signal.throwIfAborted();
    const result = await executeCandidateTool({ environmentBindings: env, runtime: production.runtime, toolKey: body.toolKey, task: production.task });
    signal.throwIfAborted();
    console.info(JSON.stringify({ event: "candidate-tool-outcome", toolKey: body.toolKey, outcome: result.outcome, safeCode: result.errorCode ?? null }));
    return Response.json(result, { status: result.outcome === "SUCCEEDED" ? 200 : 503, headers });
  } catch (error) {
    const code = candidateToolErrorCode(error);
    const safeCode = code === "PRODUCTION_TOOL_EXECUTION_FAILED" ? "PRODUCTION_RUNTIME_PREPARATION_FAILED" : code;
    console.info(JSON.stringify({ event: "candidate-tool-preparation-error", safeCode }));
    return Response.json({ outcome: "FAILED", errorCode: safeCode }, { status: 422, headers });
  } finally {
    execution?.stop();
  }
}
