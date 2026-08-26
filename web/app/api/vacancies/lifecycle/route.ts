import { executeVacancyLifecycleCommand, ProductConflictError, ProductNotFoundError, VacancyLifecycleConflictError } from "../../../../server/product/application.ts";
import type { VacancyLifecycleAction } from "../../../product-model.ts";
import { requestPrincipal } from "../../../../server/auth/request-principal.ts";

const headers = { "cache-control": "private, no-store" };

export async function POST(request: Request) {
  const actor = await requestPrincipal(request);
  if (!actor) return Response.json({ error: "Требуется авторизация" }, { status: 401, headers });
  try {
    const payload = await request.json() as { vacancyId?: string; action?: VacancyLifecycleAction };
    if (!payload.vacancyId?.trim() || !payload.action || !["archive", "restore", "delete"].includes(payload.action)) {
      return Response.json({ error: "Недопустимая команда" }, { status: 400, headers });
    }
    const { productRepository } = await import("../../../../server/product/runtime-bindings.ts");
    const vacancy = await executeVacancyLifecycleCommand(await productRepository(), { vacancyId: payload.vacancyId, action: payload.action, actor });
    return Response.json({ vacancy }, { headers });
  } catch (error) {
    const status = error instanceof ProductNotFoundError ? 404 : error instanceof ProductConflictError ? 409 : 422;
    return Response.json({
      error: error instanceof Error ? error.message : "Команда отклонена",
      code: error instanceof VacancyLifecycleConflictError ? error.code : undefined,
    }, { status, headers });
  }
}
