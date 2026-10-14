
import { requestPrincipal } from "../../../server/auth/request-principal.ts";

import type { CandidateId } from "../../../app/product-model.ts";
import { ProductNotFoundError } from "../../../server/product/application.ts";

const headers = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  if (!await requestPrincipal(request)) return Response.json({ error: "Требуется авторизация" }, { status: 401, headers });
  const parameters = new URL(request.url).searchParams;
  let candidateId: CandidateId | undefined;
  if (parameters.has("candidateId")) {
    try {
      const value: unknown = JSON.parse(parameters.get("candidateId")!);
      if (!((typeof value === "string" && value.trim().length > 0 && value.length <= 200)
        || (typeof value === "number" && Number.isSafeInteger(value) && value > 0))) throw new Error("INVALID_CANDIDATE_ID");
      candidateId = value;
    } catch {
      return Response.json({ error: "Некорректный идентификатор кандидата" }, { status: 400, headers });
    }
  }
  try {
    const { productRepository } = await import("../../../server/product/runtime-bindings.ts");
    const summaryOnly = parameters.get("summary") === "1";
    const source = await (await productRepository()).dashboardSource({ summaryOnly, ...(candidateId === undefined ? {} : { candidateId }) });
    if (candidateId !== undefined && !source.candidates.some((candidate) => candidate.id === candidateId)) {
      return Response.json({ error: "Кандидат не найден" }, { status: 404, headers });
    }
    return Response.json(source, { headers });
  } catch (error) {
    if (error instanceof ProductNotFoundError) return Response.json({ error: "Кандидат не найден" }, { status: 404, headers });
    return Response.json({ error: "Рабочие данные временно недоступны" }, { status: 503, headers });
  }
}
