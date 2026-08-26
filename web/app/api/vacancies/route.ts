import { createVacancy, ProductConflictError } from "../../../server/product/application.ts";
import { requestPrincipal } from "../../../server/auth/request-principal.ts";

const headers = { "cache-control": "private, no-store" };

export async function POST(request: Request) {
  if (!await requestPrincipal(request)) return Response.json({ error: "Требуется авторизация" }, { status: 401, headers });
  try {
    const { productRepository } = await import("../../../server/product/runtime-bindings.ts");
    const repository = await productRepository();
    const { DriveVacancyFolderGateway } = await import("../../../server/product/drive-adapters.ts");
    const vacancy = await createVacancy(repository, new DriveVacancyFolderGateway(), await request.json());
    return Response.json({ vacancy }, { status: 201, headers });
  } catch (error) {
    const status = error instanceof ProductConflictError ? 409 : 503;
    return Response.json({ error: error instanceof ProductConflictError ? error.message : "Вакансия не сохранена: инфраструктура временно недоступна" }, { status, headers });
  }
}
