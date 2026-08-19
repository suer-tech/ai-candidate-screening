import { normalizeVacancyTitle } from "../../../product-model.ts";

const headers = { "cache-control": "private, no-store" };

export async function POST(request: Request) {
  if (!request.headers.get("oai-authenticated-user-id")) return Response.json({ error: "Требуется авторизация" }, { status: 401, headers });
  try {
    const payload = await request.json() as { title?: unknown };
    if (typeof payload.title !== "string" || !normalizeVacancyTitle(payload.title)) {
      return Response.json({ error: "Название вакансии обязательно" }, { status: 400, headers });
    }
    const { productRepository } = await import("../../../../server/product/runtime-bindings.ts");
    const available = await productRepository().isVacancyTitleAvailable(normalizeVacancyTitle(payload.title));
    return Response.json({ available, error: available ? null : "Вакансия с таким названием уже существует" }, { status: available ? 200 : 409, headers });
  } catch {
    return Response.json({ error: "Проверка названия временно недоступна" }, { status: 503, headers });
  }
}
