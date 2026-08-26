import { timingSafeEqual } from "node:crypto";

function equalSecret(left: string | null, right: string) {
  if (!left) return false;
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function handleInternalTaskRequest(
  request: Request,
  options: { token?: string; publish: (payload: unknown) => Promise<{ taskId: string }> },
): Promise<Response> {
  if (!options.token) return Response.json({ ready: false, code: "INTERNAL_TOKEN_NOT_CONFIGURED" }, { status: 503 });
  if (!equalSecret(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null, options.token)) {
    return Response.json({ ready: false, code: "UNAUTHORIZED" }, { status: 401 });
  }
  if (request.method !== "POST") return Response.json({ ready: false, code: "METHOD_NOT_ALLOWED" }, { status: 405 });
  const payload = await request.json();
  const published = await options.publish(payload);
  return Response.json({ accepted: true, taskId: published.taskId, execution: "background" }, { status: 200 });
}
