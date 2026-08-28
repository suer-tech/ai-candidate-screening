import { ProductNotFoundError, readCurrentResult } from "../../../server/product/application.ts";
import type { ResultDocumentType } from "../../product-model.ts";
import { requestPrincipal } from "../../../server/auth/request-principal.ts";

const DOCUMENTS = new Set<ResultDocumentType>(["candidate-report", "candidate-results", "abc-test"]);
const PRIVATE_HEADERS = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  const principalId = await requestPrincipal(request);
  if (!principalId) return Response.json({ error: "Требуется авторизация" }, { status: 401, headers: PRIVATE_HEADERS });
  const url = new URL(request.url);
  const candidateRaw = url.searchParams.get("candidate")?.trim() ?? "";
  const candidateId = /^\d+$/.test(candidateRaw) ? Number(candidateRaw) : candidateRaw;
  const version = Number(url.searchParams.get("version"));
  const type = url.searchParams.get("type") as ResultDocumentType | null;
  const validCandidate = typeof candidateId === "number" ? Number.isInteger(candidateId) && candidateId > 0 : /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(candidateId);
  if (!validCandidate || !Number.isInteger(version) || version < 1 || !type || !DOCUMENTS.has(type)) {
    return Response.json({ error: "Недопустимый идентификатор документа" }, { status: 400, headers: PRIVATE_HEADERS });
  }
  try {
    const mode = url.searchParams.get("download") === "1" ? "download" : "preview";
    const { productRepository } = await import("../../../server/product/runtime-bindings.ts");
    const repository = await productRepository();
    const { DriveResultArtifactGateway } = await import("../../../server/product/drive-adapters.ts");
    const result = await readCurrentResult(repository, new DriveResultArtifactGateway(), {
      principalId,
      candidateId,
      version,
      type,
      mode,
    });
    const disposition = mode === "download" ? "attachment" : "inline";
    return new Response(Uint8Array.from(result.bytes).buffer, { headers: {
      "content-type": "application/pdf",
      "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(result.descriptor.fileName)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    } });
  } catch (error) {
    const status = error instanceof ProductNotFoundError ? 404 : 503;
    const message = error instanceof ProductNotFoundError ? error.message : "Документ временно недоступен";
    return Response.json({ error: message }, { status, headers: PRIVATE_HEADERS });
  }
}
