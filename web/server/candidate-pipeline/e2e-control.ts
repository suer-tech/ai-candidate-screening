const PRIVATE_HEADERS = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
const ALLOWED = [
  ["POST", /^\/preflight$/],
  ["POST", /^\/runs$/],
  ["POST", /^\/runs\/[A-Za-z0-9_-]+\/vacancy$/],
  ["POST", /^\/runs\/[A-Za-z0-9_-]+\/candidates$/],
  ["GET", /^\/runs\/[A-Za-z0-9_-]+$/],
  ["GET", /^\/runs\/[A-Za-z0-9_-]+\/evidence\/(vacancy|transcript|abc|result|versioning|failure-matrix|comparison|lifecycle|run)$/],
  ["POST", /^\/runs\/[A-Za-z0-9_-]+\/evidence\/report-publication$/],
  ["POST", /^\/runs\/[A-Za-z0-9_-]+\/cleanup$/],
] as const;

export type E2eControlEnvironment = {
  E2E_CONTROL_TOKEN?: string;
  E2E_FIXTURE_CONTROL_URL?: string;
  E2E_FIXTURE_CONTROL_TOKEN?: string;
  E2E_ENVIRONMENT?: string;
  E2E_ALLOW_DESTRUCTIVE_CLEANUP?: string;
  CANDIDATE_PIPELINE_BUILD_ID?: string;
};

export async function handleExternalE2eControl(request: Request, path: string, environment: E2eControlEnvironment, fetcher: typeof fetch = fetch) {
  if (!constantTimeBearer(request.headers.get("authorization"), environment.E2E_CONTROL_TOKEN)) return Response.json({ error: "E2E_CONTROL_UNAUTHORIZED" }, { status: 401, headers: PRIVATE_HEADERS });
  if (!new Set(["staging", "preproduction"]).has(environment.E2E_ENVIRONMENT ?? "") || environment.E2E_ALLOW_DESTRUCTIVE_CLEANUP !== "true") return Response.json({ error: "E2E_DESTRUCTIVE_ENVIRONMENT_DENIED" }, { status: 403, headers: PRIVATE_HEADERS });
  if (!ALLOWED.some(([method, pattern]) => method === request.method && pattern.test(path))) return Response.json({ error: "E2E_CONTROL_OPERATION_NOT_ALLOWED" }, { status: 404, headers: PRIVATE_HEADERS });
  let upstream: URL;
  try {
    upstream = new URL(path, requiredHttpsOrigin(environment.E2E_FIXTURE_CONTROL_URL));
  } catch { return Response.json({ error: "E2E_FIXTURE_CONTROL_UNAVAILABLE" }, { status: 503, headers: PRIVATE_HEADERS }); }
  const serviceToken = environment.E2E_FIXTURE_CONTROL_TOKEN?.trim();
  if (!serviceToken || !environment.CANDIDATE_PIPELINE_BUILD_ID?.trim()) return Response.json({ error: "E2E_FIXTURE_CONTROL_UNAVAILABLE" }, { status: 503, headers: PRIVATE_HEADERS });
  const body = request.method === "GET" ? undefined : await boundedBody(request);
  if (body === null) return Response.json({ error: "E2E_CONTROL_BODY_TOO_LARGE" }, { status: 413, headers: PRIVATE_HEADERS });
  try {
    const response = await fetcher(upstream, { method: request.method, headers: { authorization: `Bearer ${serviceToken}`, "content-type": "application/json", "x-e2e-build-id": environment.CANDIDATE_PIPELINE_BUILD_ID, "x-e2e-environment": environment.E2E_ENVIRONMENT ?? "" }, body, signal: AbortSignal.timeout(60_000) });
    if (response.headers.get("content-type")?.split(";", 1)[0] !== "application/json") throw new Error("NON_JSON_CONTROL_RESPONSE");
    const payload = await response.json() as unknown;
    assertSafeEvidence(payload);
    return Response.json(payload, { status: response.status, headers: PRIVATE_HEADERS });
  } catch { return Response.json({ error: "E2E_FIXTURE_CONTROL_UNAVAILABLE" }, { status: 503, headers: PRIVATE_HEADERS }); }
}

function constantTimeBearer(header: string | null, expected: string | undefined) {
  const actual = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!expected || !actual || actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

function requiredHttpsOrigin(value: string | undefined) {
  const url = new URL(value ?? "");
  if (url.protocol !== "https:" || /localhost|127\.0\.0\.1|\.invalid$/i.test(url.hostname)) throw new Error("INVALID_CONTROL_ORIGIN");
  return `${url.origin}${url.pathname.replace(/\/?$/, "/")}`;
}

async function boundedBody(request: Request) {
  const bytes = new Uint8Array(await request.arrayBuffer());
  return bytes.byteLength > 256 * 1024 ? null : bytes;
}

function assertSafeEvidence(value: unknown, depth = 0) {
  if (depth > 20) throw new Error("EVIDENCE_TOO_DEEP");
  if (typeof value === "string") {
    if (/-----BEGIN (?:PRIVATE KEY|CERTIFICATE)-----|api\.telegram\.org\/bot[^/\s]+|Bearer\s+[A-Za-z0-9._-]+/i.test(value)) throw new Error("UNSAFE_EVIDENCE_VALUE");
    return;
  }
  if (Array.isArray(value)) { for (const item of value) assertSafeEvidence(item, depth + 1); return; }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (/^(authorization|token|secret|chat_?id|raw_?prompt|protected_?trace_?body|personal_?text)$/i.test(key)) throw new Error("UNSAFE_EVIDENCE_KEY");
    assertSafeEvidence(item, depth + 1);
  }
}
