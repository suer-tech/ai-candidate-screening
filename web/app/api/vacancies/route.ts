import { createVacancy, ProductConflictError } from "../../../server/product/application.ts";

const headers = { "cache-control": "private, no-store" };

export async function POST(request: Request) {
  if (!request.headers.get("oai-authenticated-user-id")) return Response.json({ error: "Требуется авторизация" }, { status: 401, headers });
  try {
    const [{ productRepository }, { DriveVacancyFolderGateway }] = await Promise.all([
      import("../../../server/product/runtime-bindings.ts"),
      import("../../../server/product/drive-adapters.ts"),
    ]);
    const vacancy = await createVacancy(productRepository(), new DriveVacancyFolderGateway(), await request.json());
    return Response.json({ vacancy }, { status: 201, headers });
  } catch (error) {
    const status = error instanceof ProductConflictError ? 409 : 503;
    return Response.json({ error: error instanceof ProductConflictError ? error.message : "Вакансия не сохранена: инфраструктура временно недоступна" }, { status, headers });
  }
}
