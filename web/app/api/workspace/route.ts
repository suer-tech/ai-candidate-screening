
const headers = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  if (!request.headers.get("oai-authenticated-user-id")) return Response.json({ error: "Требуется авторизация" }, { status: 401, headers });
  try {
    const { productRepository } = await import("../../../server/product/runtime-bindings.ts");
    return Response.json(await productRepository().dashboardSource(), { headers });
  } catch {
    return Response.json({ error: "Рабочие данные временно недоступны" }, { status: 503, headers });
  }
}
