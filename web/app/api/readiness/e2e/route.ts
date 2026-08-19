import { evaluateProductionReadiness } from "../../../../server/readiness/e2e-preflight.ts";
import { loadRuntimeConfiguration } from "../../../../server/llm/runtime-loader.ts";

const PRIVATE_HEADERS = { "cache-control": "private, no-store" };

function equalSecret(actual: string | null, expected: unknown) {
  if (typeof expected !== "string" || !expected || actual === null || actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

export async function GET(request: Request) {
  const identity = request.headers.get("oai-authenticated-user-id");
  if (!identity) return Response.json({ ready: false, error: "HR_IDENTITY_MISSING" }, { status: 401, headers: PRIVATE_HEADERS });

  try {
    const { env } = await import("cloudflare:workers");
    if (typeof env.E2E_PREFLIGHT_TOKEN !== "string" || !env.E2E_PREFLIGHT_TOKEN.trim()) {
      return Response.json({ ready: false, error: "PREFLIGHT_INFRASTRUCTURE_UNAVAILABLE" }, { status: 503, headers: PRIVATE_HEADERS });
    }
    if (!equalSecret(request.headers.get("x-e2e-preflight-token"), env.E2E_PREFLIGHT_TOKEN)) {
      return Response.json({ ready: false, error: "PREFLIGHT_ACCESS_DENIED" }, { status: 403, headers: PRIVATE_HEADERS });
    }
    const readiness = await evaluateProductionReadiness({
      identity,
      database: env.DB,
      traceBucket: env.PROTECTED_LLM_TRACES,
      environment: env,
      validateLlm(environment, capabilities) {
        loadRuntimeConfiguration(environment, capabilities);
      },
    });
    return Response.json(readiness, { status: readiness.ready ? 200 : 503, headers: PRIVATE_HEADERS });
  } catch {
    return Response.json({ ready: false, error: "PREFLIGHT_INFRASTRUCTURE_UNAVAILABLE" }, { status: 503, headers: PRIVATE_HEADERS });
  }
}
