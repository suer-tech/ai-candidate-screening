
import { requestPrincipal } from "../../../server/auth/request-principal.ts";

const headers = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  if (!await requestPrincipal(request)) return Response.json({ error: "Требуется авторизация" }, { status: 401, headers });
  try {
    const { productRepository } = await import("../../../server/product/runtime-bindings.ts");
    return Response.json(await (await productRepository()).dashboardSource(), { headers });
  } catch {
    return Response.json({ error: "Рабочие данные временно недоступны" }, { status: 503, headers });
  }
}
