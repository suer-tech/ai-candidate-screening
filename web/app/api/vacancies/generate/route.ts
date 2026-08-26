import { generateVacancyProfile, VacancyGenerationPublicError } from "../../../../server/product/vacancy-generation.ts";
import { requestPrincipal } from "../../../../server/auth/request-principal.ts";
import { serverContainer } from "../../../../server/configuration/container.ts";
import { randomUUID } from "node:crypto";
import type { VacancyRecord } from "../../../product-model.ts";
import type { AbcProfileDirection } from "../../../abc-profile-validation.ts";
import { generationPromptMapWithDefaults, VACANCY_GENERATION_PROMPT_KEYS, type VacancyGenerationPromptKey } from "../../../../server/product/prompt-contracts.ts";
import { validateAbcGenerationResult, validateFieldGenerationResult } from "../../../../server/product/field-level-vacancy-generation.ts";

const headers = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  if (!await requestPrincipal(request)) return Response.json({ error: { code: "AUTH_REQUIRED", message: "Требуется авторизация" } }, { status: 401, headers });
  try {
    const operationId = new URL(request.url).searchParams.get("operationId")?.trim();
    if (!operationId) return Response.json({ error: { code: "OPERATION_ID_REQUIRED", message: "Операция не указана" } }, { status: 400, headers });
    const { productRepository } = await import("../../../../server/product/runtime-bindings.ts");
    const operation = await (await productRepository()).getGeneration(operationId);
    if (!operation) return Response.json({ error: { code: "NOT_FOUND", message: "Операция ещё не началась" } }, { status: 404, headers });
    return Response.json({ operation: { state: operation.state, attemptCount: operation.attemptCount } }, { status: 200, headers });
  } catch {
    return Response.json({ error: { code: "GENERATION_STATUS_UNAVAILABLE", message: "Статус временно недоступен" } }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  const actor = await requestPrincipal(request);
  if (!actor) return Response.json({ error: { code: "AUTH_REQUIRED", message: "Требуется авторизация" } }, { status: 401, headers });
  try {
    const [{ productRepository }, { RouterAiVacancyProfileProvider, RouterAiVacancySectionProvider }] = await Promise.all([
      import("../../../../server/product/runtime-bindings.ts"),
      import("../../../../server/product/vacancy-provider.ts"),
    ]);
    const repository = await productRepository();
    const payload = await request.json() as { operationId?: unknown; title?: unknown; vacancyId?: unknown; prompt?: unknown; operationType?: unknown; field?: unknown; abcDirections?: unknown };
    const vacancyId = typeof payload.vacancyId === "string" ? payload.vacancyId : "";
    if (!vacancyId) return Response.json({ error: { code: "VACANCY_NOT_FOUND", message: "Вакансия не найдена" } }, { status: 404, headers });
    const { sql } = await serverContainer();
    const vacancyRows = await sql<{ record_json: string }[]>`SELECT record_json FROM vacancies WHERE id=${vacancyId}`;
    if (!vacancyRows[0]) return Response.json({ error: { code: "VACANCY_NOT_FOUND", message: "Вакансия не найдена" } }, { status: 404, headers });
    const vacancy = JSON.parse(vacancyRows[0].record_json) as VacancyRecord;
    const operationType = payload.operationType === "field" || payload.operationType === "abc" ? payload.operationType : "all";
    if (operationType !== "all") {
      const key: VacancyGenerationPromptKey | null = operationType === "abc"
        ? "ABC-критерии"
        : typeof payload.field === "string" && VACANCY_GENERATION_PROMPT_KEYS.includes(payload.field as VacancyGenerationPromptKey) && payload.field !== "ABC-критерии" ? payload.field as VacancyGenerationPromptKey : null;
      if (!key) return Response.json({ error: { code: "GENERATION_FIELD_INVALID", message: "Поле генерации не поддерживается" } }, { status: 400, headers });
      const directions = operationType === "abc" && Array.isArray(payload.abcDirections) ? payload.abcDirections as AbcProfileDirection[] : [];
      if (operationType === "abc" && !directions.length) return Response.json({ error: { code: "ABC_DIRECTIONS_REQUIRED", message: "Сначала добавьте хотя бы одно ABC-направление" } }, { status: 422, headers });
      const prompt = generationPromptMapWithDefaults(vacancy.title, vacancy.generationPrompts)[key];
      const operationId = typeof payload.operationId === "string" && payload.operationId.trim() ? payload.operationId : randomUUID();
      const providerResponse = await new RouterAiVacancySectionProvider().generate({ operationId: `${vacancyId}:${operationId}`, title: vacancy.title, key, prompt, directions });
      const result = operationType === "abc"
        ? { abcDirections: validateAbcGenerationResult(providerResponse, directions) }
        : validateFieldGenerationResult(providerResponse, key as Exclude<VacancyGenerationPromptKey, "ABC-критерии">);
      await sql`INSERT INTO vacancy_audit_events(id,operation_id,event_type,actor,created_at,vacancy_id,prompt_artifact_id,after_hash,trace_id)
        VALUES(${randomUUID()},${operationId},${operationType === "abc" ? "abc_generation_completed" : "field_generation_completed"},${actor},${new Date().toISOString()},${vacancyId},${prompt.artifactId},${prompt.hash},${randomUUID()})`;
      return Response.json({ operation: { operationId, state: "SUCCEEDED", result } }, { status: 200, headers });
    }
    const operation = await generateVacancyProfile({
      repository,
      provider: new RouterAiVacancyProfileProvider(),
      retryDelayMs: 500,
      audit: {
        append: (event) => repository.appendVacancyAudit({ ...event, actor }),
      },
    }, {
      operationId: typeof payload.operationId === "string" ? payload.operationId : "",
      title: vacancy.title,
      vacancyId,
      prompt: payload.prompt,
    });
    await sql`INSERT INTO vacancy_audit_events(id,operation_id,event_type,actor,created_at,vacancy_id,prompt_artifact_id,after_hash,trace_id)
      VALUES(${randomUUID()},${operation.operationId},'generation_prompt_applied',${actor},${new Date().toISOString()},${vacancyId},${operation.promptArtifactId ?? null},${operation.promptHash ?? null},${randomUUID()})`;
    if (operation.state === "PENDING") return Response.json({ operation: { state: operation.state, attemptCount: operation.attemptCount } }, { status: 202, headers });
    return Response.json({
      operation: {
        operationId: operation.operationId,
        state: operation.state,
        attemptCount: operation.attemptCount,
        profile: operation.generatedProfile,
        snapshotHash: operation.snapshotHash,
      },
    }, { status: 200, headers });
  } catch (error) {
    if (error instanceof VacancyGenerationPublicError) {
      const status = error.code === "VACANCY_TITLE_DUPLICATE" || error.code === "VACANCY_GENERATION_OPERATION_CONFLICT" ? 409 : error.code === "VACANCY_TITLE_REQUIRED" || (error.code === "VACANCY_GENERATION_CONFIG" && error.attempts === 0) ? 400 : 503;
      return Response.json({ error: { code: error.code, message: error.message, attempts: error.attempts, retryAvailable: error.attempts > 0 } }, { status, headers });
    }
    return Response.json({ error: { code: "VACANCY_GENERATION_UNAVAILABLE", message: "Описание вакансии временно не удалось сформировать", attempts: 0, retryAvailable: true } }, { status: 503, headers });
  }
}
