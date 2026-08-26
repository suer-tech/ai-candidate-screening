import { executeLifecycleCommand, ProductConflictError, ProductNotFoundError } from "../../../../server/product/application.ts";
import type { CandidateId } from "../../../product-model.ts";
import { requestPrincipal } from "../../../../server/auth/request-principal.ts";

const headers = { "cache-control": "private, no-store" };

export async function POST(request: Request) {
  const actor = await requestPrincipal(request);
  if (!actor) return Response.json({ error: "Требуется авторизация" }, { status: 401, headers });
  try {
    const payload = await request.json() as { candidateId: CandidateId; action: "archive" | "restore" | "delete" | "reprocess"; expectedRevision: number };
    const { productRepository } = await import("../../../../server/product/runtime-bindings.ts");
    const candidate = await executeLifecycleCommand(await productRepository(), { ...payload, actor });
    return Response.json({ candidate }, { headers });
  } catch (error) {
    const status = error instanceof ProductNotFoundError ? 404 : error instanceof ProductConflictError ? 409 : 422;
    return Response.json({ error: error instanceof Error ? error.message : "Команда отклонена" }, { status, headers });
  }
}
