import { requestPrincipal } from "../../../../server/auth/request-principal.ts";
import { serverContainer } from "../../../../server/configuration/container.ts";
import { CANDIDATE_ASSESSMENT_PROMPT_ARTIFACT, createEditablePromptSnapshot, generationPromptMapWithDefaults, renderVacancyGenerationPrompt, standardEditablePrompt, VACANCY_GENERATION_PROMPT_ARTIFACT, VACANCY_GENERATION_PROMPT_KEYS, type VacancyGenerationPromptKey } from "../../../../server/product/prompt-contracts.ts";
import type { VacancyRecord } from "../../../product-model.ts";
import { randomUUID } from "node:crypto";

const headers = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  if (!await requestPrincipal(request)) return Response.json({ error: { code: "AUTH_REQUIRED", message: "Требуется авторизация" } }, { status: 401, headers });
  const vacancyId = new URL(request.url).searchParams.get("vacancyId")?.trim();
  if (!vacancyId) return Response.json({ error: { code: "VACANCY_NOT_FOUND", message: "Вакансия не найдена" } }, { status: 404, headers });
  try {
    const { sql } = await serverContainer();
    const rows = await sql<{ record_json: string }[]>`SELECT record_json FROM vacancies WHERE id=${vacancyId}`;
    if (!rows[0]) return Response.json({ error: { code: "VACANCY_NOT_FOUND", message: "Вакансия не найдена" } }, { status: 404, headers });
    const vacancy = JSON.parse(rows[0].record_json) as VacancyRecord;
    const generation = renderVacancyGenerationPrompt(vacancy.title);
    const analysisDefault = standardEditablePrompt(CANDIDATE_ASSESSMENT_PROMPT_ARTIFACT);
    const fieldGenerationDefaults = generationPromptMapWithDefaults(vacancy.title);
    const fieldGenerationPrompts = generationPromptMapWithDefaults(vacancy.title, vacancy.generationPrompts);
    return Response.json({ generation, analysis: vacancy.analysisPrompt ?? analysisDefault, analysisDefault, fieldGenerationPrompts, fieldGenerationDefaults, generationPromptsRevision: vacancy.generationPromptsRevision ?? 0 }, { headers });
  } catch {
    return Response.json({ error: { code: "PROMPTS_UNAVAILABLE", message: "Инструкции временно недоступны" } }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  const actor = await requestPrincipal(request);
  if (!actor) return Response.json({ error: { code: "AUTH_REQUIRED", message: "Требуется авторизация" } }, { status: 401, headers });
  try {
    const payload = await request.json() as { vacancyId?: unknown; expectedRevision?: unknown; key?: unknown; prompt?: unknown };
    const vacancyId = typeof payload.vacancyId === "string" ? payload.vacancyId.trim() : "";
    const key = typeof payload.key === "string" && VACANCY_GENERATION_PROMPT_KEYS.includes(payload.key as VacancyGenerationPromptKey) ? payload.key as VacancyGenerationPromptKey : null;
    if (!vacancyId || !key || !Number.isInteger(payload.expectedRevision)) return Response.json({ error: { code: "PROMPT_INVALID", message: "Проверьте параметры промпта" } }, { status: 400, headers });
    let snapshot;
    try { snapshot = createEditablePromptSnapshot(payload.prompt, VACANCY_GENERATION_PROMPT_ARTIFACT); }
    catch (error) { return Response.json({ error: { code: "PROMPT_INVALID", message: error instanceof Error ? error.message : "Проверьте промпт" } }, { status: 422, headers }); }
    const { sql } = await serverContainer();
    const rows = await sql<{ record_json: string }[]>`SELECT record_json FROM vacancies WHERE id=${vacancyId}`;
    if (!rows[0]) return Response.json({ error: { code: "VACANCY_NOT_FOUND", message: "Вакансия не найдена" } }, { status: 404, headers });
    const current = JSON.parse(rows[0].record_json) as VacancyRecord;
    const revision = current.generationPromptsRevision ?? 0;
    if (revision !== payload.expectedRevision) return Response.json({ error: { code: "PROMPT_CONFLICT", message: "Промпт уже изменён. Обновите страницу" } }, { status: 409, headers });
    const beforeHash = current.generationPrompts?.[key]?.hash ?? null;
    const updated: VacancyRecord = { ...current, generationPrompts: { ...current.generationPrompts, [key]: snapshot }, generationPromptsRevision: revision + 1 };
    const changed = await sql`UPDATE vacancies SET record_json=${JSON.stringify(updated)} WHERE id=${vacancyId} AND record_json=${rows[0].record_json} RETURNING id`;
    if (!changed[0]) return Response.json({ error: { code: "PROMPT_CONFLICT", message: "Промпт уже изменён. Обновите страницу" } }, { status: 409, headers });
    await sql`INSERT INTO vacancy_audit_events(id,operation_id,event_type,actor,created_at,vacancy_id,prompt_artifact_id,before_hash,after_hash,trace_id)
      VALUES(${randomUUID()},${`field-prompt-save:${vacancyId}:${key}:${revision + 1}`},'vacancy_generation_prompt_saved',${actor},${new Date().toISOString()},${vacancyId},${VACANCY_GENERATION_PROMPT_ARTIFACT},${beforeHash},${snapshot.hash},${randomUUID()})`;
    return Response.json({ prompt: snapshot, key, generationPromptsRevision: revision + 1 }, { headers });
  } catch {
    return Response.json({ error: { code: "PROMPTS_UNAVAILABLE", message: "Промпт временно не удалось сохранить" } }, { status: 503, headers });
  }
}
