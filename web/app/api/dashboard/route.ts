import { getOperationalDashboard } from "../../../server/product/application.ts";

const headers = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  if (!request.headers.get("oai-authenticated-user-id")) return Response.json({ error: "Требуется авторизация" }, { status: 401, headers });
  const value = Number(new URL(request.url).searchParams.get("period") ?? "7");
  if (value !== 7 && value !== 30 && value !== 90) return Response.json({ error: "Недопустимый период" }, { status: 400, headers });
  try {
    const { productRepository } = await import("../../../server/product/runtime-bindings.ts");
    return Response.json({ snapshot: await getOperationalDashboard(productRepository(), value) }, { headers });
  } catch {
    return Response.json({ error: "Операционные данные временно недоступны" }, { status: 503, headers });
  }
}
