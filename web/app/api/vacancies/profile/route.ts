import { requestPrincipal } from "../../../../server/auth/request-principal.ts";
import { serverContainer } from "../../../../server/configuration/container.ts";
import { validateAbcProfile, type AbcProfileDirection } from "../../../abc-profile-validation.ts";
import type { VacancyRecord } from "../../../product-model.ts";
import { CANDIDATE_ASSESSMENT_PROMPT_ARTIFACT, createEditablePromptSnapshot } from "../../../../server/product/prompt-contracts.ts";
import { randomUUID } from "node:crypto";

const headers = { "cache-control": "private, no-store" };

export async function POST(request: Request) {
  const actor = await requestPrincipal(request);
  if (!actor) return Response.json({ error: "Требуется авторизация" }, { status: 401, headers });
  try {
    const payload = await request.json() as { vacancyId?: unknown; expectedVersion?: unknown; profile?: unknown; abcDirections?: unknown; templateVersion?: unknown; analysisPrompt?: unknown };
    if (typeof payload.vacancyId !== "string" || !Number.isInteger(payload.expectedVersion) || !payload.profile || typeof payload.profile !== "object" || !Array.isArray(payload.abcDirections)) {
      return Response.json({ error: "Некорректные параметры профиля" }, { status: 400, headers });
    }
    const profile = Object.fromEntries(Object.entries(payload.profile as Record<string, unknown>).map(([key, value]) => [key, typeof value === "string" ? value : ""]));
    const abcDirections = payload.abcDirections as AbcProfileDirection[];
    const validation = validateAbcProfile(abcDirections);
    if (!validation.valid) return Response.json({ error: validation.errors[0]?.message ?? "Проверьте ABC-критерии" }, { status: 422, headers });
    const { sql } = await serverContainer();
    const rows = await sql<{ record_json: string }[]>`SELECT record_json FROM vacancies WHERE id=${payload.vacancyId}`;
    if (!rows[0]) return Response.json({ error: "Вакансия не найдена" }, { status: 404, headers });
    const current = JSON.parse(rows[0].record_json) as VacancyRecord;
    if (current.version !== payload.expectedVersion) return Response.json({ error: "Профиль уже изменён. Обновите страницу" }, { status: 409, headers });
    let analysisPrompt = current.analysisPrompt;
    if (payload.analysisPrompt !== undefined) {
      try { analysisPrompt = createEditablePromptSnapshot(payload.analysisPrompt, CANDIDATE_ASSESSMENT_PROMPT_ARTIFACT); }
      catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Проверьте промпт для анализа" }, { status: 422, headers }); }
    }
    const vacancy: VacancyRecord = { ...current, version: current.version + 1, profile, requirements: undefined, abcDirections, analysisPrompt, templateVersion: typeof payload.templateVersion === "string" ? payload.templateVersion : current.templateVersion };
    const updated = await sql<{ id: string }[]>`WITH changed AS (
      UPDATE vacancies SET record_json=${JSON.stringify(vacancy)} WHERE id=${payload.vacancyId} AND record_json=${rows[0].record_json} RETURNING id
    ) INSERT INTO vacancy_profile_versions(vacancy_id,version,record_json,created_at)
      SELECT id,${vacancy.version},${JSON.stringify(vacancy)},${new Date().toISOString()} FROM changed RETURNING vacancy_id AS id`;
    if (!updated[0]) return Response.json({ error: "Профиль уже изменён. Обновите страницу" }, { status: 409, headers });
    if (payload.analysisPrompt !== undefined) await sql`INSERT INTO vacancy_audit_events(id,operation_id,event_type,actor,created_at,vacancy_id,prompt_artifact_id,before_hash,after_hash,trace_id)
      VALUES(${randomUUID()},${`prompt-save:${payload.vacancyId}:${vacancy.version}`},'analysis_prompt_saved',${actor},${new Date().toISOString()},${payload.vacancyId},${CANDIDATE_ASSESSMENT_PROMPT_ARTIFACT},${current.analysisPrompt?.hash ?? null},${analysisPrompt?.hash ?? null},${randomUUID()})`;
    return Response.json({ vacancy }, { status: 200, headers });
  } catch {
    return Response.json({ error: "Не удалось сохранить профиль вакансии" }, { status: 503, headers });
  }
}
