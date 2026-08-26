import { handleExternalE2eControl } from "../../../../server/candidate-pipeline/e2e-control.ts";
import { serverContainer } from "../../../../server/configuration/container.ts";

async function control(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  const env = (await serverContainer()).environment;
  const params = await context.params;
  return handleExternalE2eControl(request, `/${(params.path ?? []).join("/")}`, env);
}

export const GET = control;
export const POST = control;
