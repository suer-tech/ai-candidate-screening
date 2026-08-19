"use client";

import { useEffect, useState } from "react";
import { type AbcDirectionField, type AbcProfileDirection, type AbcProfileValidationError, validateAbcProfile } from "./abc-profile-validation";
import { DARK_THEME_QUERY, THEME_STORAGE_KEY, applyTheme, parseTheme, readStoredTheme, resolveTheme, writeStoredTheme, type Theme } from "./theme-preference";
import {
  WORKFLOW_STATUS,
  buildDashboardSnapshot,
  canArchive,
  canReprocess,
  getGreeting,
  isProcessingStatus,
  validateResultPair,
  validateVacancyTitle,
  type CandidateRecord,
  type Recommendation,
  type ResultDocumentType,
  type VacancyCreateState,
  type VacancyRecord,
  type WorkflowStatus,
} from "./product-model";

type View = "dashboard" | "vacancies" | "candidates" | "candidate";
type UiCandidate = CandidateRecord & { revision?: number; tone: string; updated: string };
type StoredUiCandidate = CandidateRecord & { revision: number };
type UiVacancy = VacancyRecord & { short: string; avatar: string; color: string };
type DashboardSnapshot = ReturnType<typeof buildDashboardSnapshot>;
type Preview = { candidateId: number; type: ResultDocumentType; version: number; title: string } | null;
type DashboardStatusFilter = "MATERIALS_INCOMPLETE" | "TRANSCRIBING" | "ANALYZING" | "VALIDATING" | "READY" | "FAILED";
type QueueFilter =
  | { kind: "status"; status: DashboardStatusFilter }
  | { kind: "archive" }
  | { kind: "recommendation"; recommendation: Recommendation; period: 7 | 30 | 90; candidateIds: number[] }
  | null;
const DRIVE_POLL_INTERVAL_MS = 15 * 1000;

const STANDARD_ABC_DIRECTIONS: readonly AbcProfileDirection[] = [
  ["productivity", "Продуктивность", "Превосходит ожидаемый результат", "Стабильно достигает результата", "Не достигает результата"],
  ["initiative", "Инициатива", "Действует проактивно", "Предлагает улучшения после постановки", "Ждёт подробных указаний"],
  ["self-learning", "Самообучаемость", "Самостоятельно осваивает новый контекст", "Осваивает с поддержкой", "Повторяет ошибки"],
  ["corporate-values", "Соответствие корпоративным ценностям", "Подтверждает ценности примерами", "В целом соответствует", "Есть подтверждённые противоречия"],
  ["autonomy", "Автономность", "Приносит варианты и рекомендацию", "Самостоятелен в типовых задачах", "Требует постоянного контроля"],
].map(([id, name, gradeA, gradeB, gradeC]) => ({ id, name, gradeA, gradeB, gradeC, origin: "standard" }));

const createStandardAbcDirections = () => structuredClone(STANDARD_ABC_DIRECTIONS) as AbcProfileDirection[];
const DEFAULT_PROFILE = { "Образ результата": "Измеримый результат роли и критерии его достижения", "Компетенции": "Компетенции, правила и наблюдаемые признаки", "Стоп-факторы": "Условия срабатывания и тип доказательства", "Допуск к КЕ": "Обязательный пункт, правила, признаки и источник результата" };

const VACANCY_COLORS = ["#ff98d8", "#ffc56b", "#58dfc4", "#87a9ff", "#a78bfa"];
const CANDIDATE_TONES = ["pink", "blue", "orange", "mint", "violet"];
const hydrateVacancy = (vacancy: VacancyRecord, index: number): UiVacancy => ({ ...vacancy, short: vacancy.title, avatar: vacancy.title.slice(0, 2).toUpperCase(), color: VACANCY_COLORS[index % VACANCY_COLORS.length] });
const hydrateCandidate = (candidate: StoredUiCandidate, index: number): UiCandidate => ({ ...candidate, tone: CANDIDATE_TONES[index % CANDIDATE_TONES.length], updated: WORKFLOW_STATUS[candidate.status] });

const nav: { id: View; label: string; icon: string }[] = [{ id: "dashboard", label: "Дашборд", icon: "⌘" }, { id: "vacancies", label: "Вакансии", icon: "▤" }, { id: "candidates", label: "Кандидаты", icon: "♙" }];
const statusClass = (status: WorkflowStatus) => `status status-${status.toLowerCase().replaceAll("_", "-")}`;
function StatusPill({ status, archived }: { status: WorkflowStatus; archived?: boolean }) { return <span className={statusClass(status)}><i />{WORKFLOW_STATUS[status]}{archived ? " · Архив" : ""}</span>; }

export default function Home() {
  const [view, setView] = useState<View>("dashboard");
  const [previousView, setPreviousView] = useState<View>("dashboard");
  const [selectedCandidate, setSelectedCandidate] = useState(1);
  const [candidates, setCandidates] = useState<UiCandidate[]>([]);
  const [vacancyState, setVacancyState] = useState<VacancyCreateState>({ vacancies: [], operationBindings: {} });
  const [toast, setToast] = useState("");
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState<Theme>("light");
  const [driveState, setDriveState] = useState<"Проверяем подключение" | "Подключён" | "Нет подключения">("Проверяем подключение");
  const [scanCountdown, setScanCountdown] = useState(15);
  const [preview, setPreview] = useState<Preview>(null);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>(null);

  useEffect(() => {
    const media = typeof window.matchMedia === "function" ? window.matchMedia(DARK_THEME_QUERY) : null;
    const synchronizeTheme = () => {
      const nextTheme = resolveTheme(readStoredTheme(), media?.matches ?? false);
      applyTheme(nextTheme);
      setTheme(nextTheme);
    };
    const handleSystemChange = () => { if (readStoredTheme() === null) synchronizeTheme(); };
    const handleStorage = (event: StorageEvent) => { if (event.key === THEME_STORAGE_KEY) synchronizeTheme(); };
    synchronizeTheme();
    media?.addEventListener("change", handleSystemChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      media?.removeEventListener("change", handleSystemChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/workspace", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const payload = await response.json() as { candidates?: StoredUiCandidate[]; vacancies?: VacancyRecord[] };
      if (!response.ok || !payload.candidates || !payload.vacancies) return;
      setCandidates(payload.candidates.map(hydrateCandidate));
      setVacancyState({ vacancies: payload.vacancies.map(hydrateVacancy), operationBindings: {} });
    }).catch(() => undefined);
    return () => controller.abort();
  }, []);
  useEffect(() => {
    let active = true;
    const checkDrive = async () => {
      setDriveState("Проверяем подключение");
      setScanCountdown(15);
      try {
        const response = await fetch("/api/integrations/google-drive/health", { cache: "no-store" });
        if (active) setDriveState(response.ok ? "Подключён" : "Нет подключения");
      } catch {
        if (active) setDriveState("Нет подключения");
      }
    };
    void checkDrive();
    const poll = window.setInterval(() => void checkDrive(), DRIVE_POLL_INTERVAL_MS);
    const clock = window.setInterval(() => setScanCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => { active = false; window.clearInterval(poll); window.clearInterval(clock); };
  }, []);
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2600); };
  const toggleTheme = () => {
    const currentTheme = parseTheme(document.documentElement.dataset.theme) ?? theme;
    const nextTheme: Theme = currentTheme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    writeStoredTheme(nextTheme);
    setTheme(nextTheme);
  };
  const navigate = (nextView: View) => { if (nextView === "candidates") setQueueFilter(null); setView(nextView); };
  const openCandidate = (id: number) => { setPreviousView(view === "candidate" ? "candidates" : view); setSelectedCandidate(id); setView("candidate"); };
  const openFilteredQueue = (filter: Exclude<QueueFilter, null>) => { setQueueFilter(filter); setView("candidates"); };
  const updateCandidate = (id: number, action: (candidate: UiCandidate) => UiCandidate) => setCandidates((items) => items.map((item) => item.id === id ? action(item) : item));
  const runLifecycle = async (action: "archive" | "restore" | "delete" | "reprocess") => {
    const current = candidates.find((candidate) => candidate.id === selectedCandidate);
    if (!current) return;
    try {
      const response = await fetch("/api/candidates/lifecycle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateId: current.id, action, expectedRevision: current.revision ?? 1 }),
      });
      const payload = await response.json() as { candidate?: StoredUiCandidate | null; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Команда отклонена");
      if (action === "delete") {
        setCandidates((items) => items.filter((item) => item.id !== current.id));
        setView("candidates");
      } else if (payload.candidate) {
        updateCandidate(current.id, (candidate) => ({ ...payload.candidate!, tone: candidate.tone, updated: candidate.updated }));
      }
      notify(action === "reprocess" ? "Повторная обработка поставлена на проверку стабильности" : "Состояние кандидата обновлено");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Команда временно недоступна");
    }
  };
  const matching = candidates.filter((candidate) => `${candidate.name} ${candidate.vacancy}`.toLowerCase().includes(query.toLowerCase()));
  const vacancies = vacancyState.vacancies as UiVacancy[];

  return <main className="app"><header className="topbar"><button className="brand" onClick={() => navigate("dashboard")}><span className="brand-mark" aria-hidden="true" /><span><b>Правильный выбор</b><small>AI talent intelligence</small></span></button><nav className="main-nav" aria-label="Основная навигация">{nav.map((item) => <button key={item.id} className={(view === "candidate" ? "candidates" : view) === item.id ? "active" : ""} onClick={() => navigate(item.id)}><span>{item.icon}</span>{item.label}</button>)}</nav><div className="top-actions"><label className="global-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" /></label><button type="button" className="theme-toggle" onClick={toggleTheme} aria-label="Тёмная тема" aria-pressed={theme === "dark"} title={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}><span className="theme-icon-dark" aria-hidden="true">☾</span><span className="theme-icon-light" aria-hidden="true">☀</span></button><span className="profile"><span className="avatar avatar-owner">АС</span><span><b>Алсу Салямова</b><small>HR-директор</small></span></span></div></header>
    {view === "dashboard" && <Dashboard driveState={driveState} countdown={scanCountdown} onOpen={openCandidate} onNavigate={navigate} onQueueFilter={openFilteredQueue} />}
    {view === "vacancies" && <Vacancies candidates={candidates} vacancyState={vacancyState} onState={setVacancyState} onOpen={openCandidate} onNotify={notify} />}
    {view === "candidates" && <Candidates items={matching} vacancies={vacancies} onOpen={openCandidate} dashboardFilter={queueFilter} onClearDashboardFilter={() => setQueueFilter(null)} />}
    {view === "candidate" && candidates.length > 0 && <CandidateDetail candidate={candidates.find((item) => item.id === selectedCandidate) ?? candidates[0]} onBack={() => setView(previousView)} onPreview={setPreview} onArchive={() => { const item = candidates.find((candidate) => candidate.id === selectedCandidate)!; if (canArchive(item) && window.confirm("Архивировать кандидата?")) void runLifecycle("archive"); }} onRestore={() => void runLifecycle("restore")} onDelete={() => { if (window.confirm("Окончательно удалить данные кандидата из приложения? Файлы Google Drive останутся без изменений.")) void runLifecycle("delete"); }} onReprocess={() => { if (window.confirm("Предыдущие результаты станут недоступны, а данные кандидата будут обновлены. Продолжить?")) void runLifecycle("reprocess"); }} />}
    {preview && <PdfPreview preview={preview} onClose={() => setPreview(null)} />}{toast && <div className="toast" role="status">✓ {toast}</div>}</main>;
}

function Dashboard({ driveState, countdown, onOpen, onNavigate, onQueueFilter }: { driveState: string; countdown: number; onOpen: (id: number) => void; onNavigate: (view: View) => void; onQueueFilter: (filter: Exclude<QueueFilter, null>) => void }) {
  const [period, setPeriod] = useState<7 | 30 | 90>(7);
  const [responseState, setResponseState] = useState<{ period: 7 | 30 | 90; snapshot: DashboardSnapshot | null; error: string }>({ period: 7, snapshot: null, error: "" });
  const snapshot = responseState.period === period ? responseState.snapshot : null;
  const loadError = responseState.period === period ? responseState.error : "";
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/dashboard?period=${period}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { snapshot?: DashboardSnapshot; error?: string };
        if (!response.ok || !payload.snapshot) throw new Error(payload.error ?? "Операционные данные недоступны");
        setResponseState({ period, snapshot: payload.snapshot, error: "" });
      })
      .catch((error) => { if (!controller.signal.aborted) setResponseState({ period, snapshot: null, error: error instanceof Error ? error.message : "Операционные данные недоступны" }); });
    return () => controller.abort();
  }, [period]);
  const cards: [DashboardStatusFilter, string, number | null, string][] = [
    ["MATERIALS_INCOMPLETE", "Недостаточно материалов", snapshot?.counts.MATERIALS_INCOMPLETE ?? null, "status-insufficient"],
    ["TRANSCRIBING", "Транскрибация", snapshot?.counts.TRANSCRIBING ?? null, "status-transcribing"],
    ["ANALYZING", "AI-анализ", snapshot?.counts.ANALYZING ?? null, "status-analyzing"],
    ["VALIDATING", "Проверка результатов", snapshot?.counts.VALIDATING ?? null, "status-validating"],
    ["READY", "Готово", snapshot?.counts.READY ?? null, "status-ready"],
    ["FAILED", "Ошибка", snapshot?.counts.FAILED ?? null, "status-failed"],
  ];
  return <div className="page dashboard-page">
    <section className="welcome-row"><div><p className="breadcrumb">Рабочее пространство / Дашборд</p><h1>{getGreeting()}, Алсу!</h1><p>Текущее состояние обработки, вакансий и опубликованных результатов.</p></div><div className={`drive-monitor drive-${driveState === "Подключён" ? "ok" : driveState === "Нет подключения" ? "down" : "checking"}`}><span className="live-dot" />Google Drive: {driveState}<small>Следующая проверка через {countdown} сек</small></div></section>
    {loadError && <div className="dashboard-data-error" role="alert">{loadError}. Статические данные не подставляются.</div>}
    <section className="panel processing-panel"><div className="panel-head"><h2>Контроль очереди</h2><button onClick={() => onNavigate("candidates")}>Вся очередь →</button></div><div className="processing-grid">{snapshot?.queue.map((candidate) => <button className="processing-card" key={candidate.id} onClick={() => onOpen(candidate.id)}><span className="avatar">{candidate.initials}</span><span className="processing-copy"><b>{candidate.name}</b><small>{candidate.vacancy}</small><em>{WORKFLOW_STATUS[candidate.status]}</em></span><span className="processing-time"><b>{candidate.etaMinutes === null ? "Недостаточно данных для прогноза" : `≈ ${candidate.etaMinutes} мин`}</b><small>прошло {candidate.elapsedMinutes} мин</small></span></button>) ?? <p>Загружаем актуальную очередь…</p>}</div></section>
    <section className="metric-grid">{cards.map(([status, label, count, tone]) => <button className={`metric-card ${tone}`} key={status} onClick={() => onQueueFilter({ kind: "status", status })}><p>{label}</p><strong>{count ?? "—"}</strong><small>Текущий workflow status</small></button>)}<button className="metric-card archive" onClick={() => onQueueFilter({ kind: "archive" })}><p>Архив</p><strong>{snapshot?.archivedCandidates ?? "—"}</strong><small>Архивированные кандидаты</small></button></section>
    <section className="dashboard-grid"><article className="panel flow-panel"><div className="panel-head"><div><p className="eyebrow">Актуальные результаты</p><h2>Поток кандидатов</h2></div><select value={period} onChange={(event) => setPeriod(Number(event.target.value) as 7 | 30 | 90)} aria-label="Период графиков"><option value="7">7 дней</option><option value="30">30 дней</option><option value="90">90 дней</option></select></div><div className="flow-summary">{snapshot?.flow.map((item) => <div key={item.vacancyId}><span>{item.title}</span><strong>{item.count}</strong></div>)}</div></article><article className="panel result-panel"><div className="panel-head"><div><p className="eyebrow">Период: {period} дней</p><h2>Результаты анализа</h2></div></div><div className="result-legend">{snapshot && Object.entries(snapshot.recommendations).map(([label, count]) => <button key={label} onClick={() => onQueueFilter({ kind: "recommendation", recommendation: label as Recommendation, period, candidateIds: snapshot.ready.filter((candidate) => candidate.result?.recommendation === label).map((candidate) => candidate.id) })}><b>{count}</b>{label}</button>)}</div></article></section>
  </div>;
}

function Vacancies({ candidates, vacancyState, onState, onOpen, onNotify }: { candidates: UiCandidate[]; vacancyState: VacancyCreateState; onState: (state: VacancyCreateState) => void; onOpen: (id: number) => void; onNotify: (message: string) => void }) {
  const vacancies = vacancyState.vacancies as UiVacancy[];
  const [selected, setSelected] = useState(0); const [tab, setTab] = useState("Кандидаты"); const [creating, setCreating] = useState(false);
  const vacancy = vacancies[selected] ?? vacancies[0];
  if (!vacancy) return <div className="page vacancies-page"><section className="page-title"><div><p className="breadcrumb">Рабочее пространство / Вакансии</p><h1>Вакансии</h1><p>Сохранённых активных вакансий пока нет.</p></div><button className="primary-button" onClick={() => setCreating(true)}>＋ Новая вакансия</button></section>{creating && <CreateVacancy existing={vacancyState} onClose={() => setCreating(false)} onCreated={(state) => { onState(state); setSelected(0); setCreating(false); onNotify("Вакансия сохранена и активна"); }} />}</div>;
  return <div className="page vacancies-page"><section className="page-title"><div><p className="breadcrumb">Рабочее пространство / Вакансии</p><h1>Вакансии</h1><p>Активные профили оценки и обработка кандидатов.</p></div><button className="primary-button" onClick={() => setCreating(true)}>＋ Новая вакансия</button></section><div className="vacancy-layout"><aside className="vacancy-sidebar panel"><div className="vacancy-nav-list">{vacancies.map((item, index) => <button className={selected === index ? "active" : ""} key={item.id} onClick={() => setSelected(index)}><i style={{ background: item.color }} /><span><b>{item.short}</b><small>{candidates.filter((candidate) => candidate.vacancyId === item.id).length} кандидатов · активна</small></span></button>)}</div></aside><section className="vacancy-main panel"><header className="vacancy-header"><div className="vacancy-heading"><span className="vacancy-avatar" style={{ background: vacancy.color }}>{vacancy.avatar}</span><div><span className="soft-badge">Активна</span><h2>{vacancy.title}</h2><p>Профиль v{vacancy.version} · Drive folder связан</p></div></div><button className="secondary-button" onClick={() => setTab("Параметры оценки")}>⚙ Настройки</button></header><div className="vacancy-tabs">{["Кандидаты", "Параметры оценки", "Активность"].map((item) => <button key={item} onClick={() => setTab(item)} className={tab === item ? "active" : ""}>{item}</button>)}</div>{tab === "Кандидаты" ? <VacancyCandidates candidates={candidates.filter((candidate) => candidate.vacancyId === vacancy.id)} onOpen={onOpen} /> : tab === "Параметры оценки" ? <VacancySettings vacancy={vacancy} onNotify={onNotify} /> : <div className="activity-feed"><h3>Активность вакансии</h3><article><i>✓</i><div><b>Вакансия активна</b><small>Версия 1 связана с Google Shared Drive</small></div></article></div>}</section></div>{creating && <CreateVacancy existing={vacancyState} onClose={() => setCreating(false)} onCreated={(state) => { onState(state); setSelected(state.vacancies.length - 1); setCreating(false); onNotify("Вакансия сохранена и активна"); }} />}</div>;
}

function VacancyCandidates({ candidates, onOpen }: { candidates: UiCandidate[]; onOpen: (id: number) => void }) { return <div className="vacancy-content"><div className="ranking-head"><div><p className="eyebrow">Canonical workflow</p><h3>Кандидаты</h3></div></div>{candidates.length ? <div className="ranking-table">{candidates.map((candidate, index) => <button className="ranking-row" key={candidate.id} onClick={() => onOpen(candidate.id)}><span>{index + 1}</span><span className="candidate-cell"><i className={`avatar ${candidate.tone}`}>{candidate.initials}</i><i><b>{candidate.name}</b><small>{candidate.updated}</small></i></span><StatusPill status={candidate.status} archived={candidate.archived} /><span>{WORKFLOW_STATUS[candidate.status]}</span><span>{candidate.etaMinutes === null ? "Недостаточно данных для прогноза" : `≈ ${candidate.etaMinutes} мин`}</span><span>›</span></button>)}</div> : <div className="vacancy-empty"><span>♙</span><b>Кандидатов пока нет</b><p>Добавьте материалы в связанную папку Google Drive.</p></div>}</div>; }

function VacancySettingsDraft({ vacancy, onNotify }: { vacancy: UiVacancy; onNotify: (message: string) => void }) {
  const [activeRule, setActiveRule] = useState("Образ результата"); const [values, setValues] = useState(() => structuredClone(vacancy.profile)); const [abcDirections, setAbcDirections] = useState(() => structuredClone(vacancy.abcDirections)); const [errors, setErrors] = useState<string[]>([]);
  const save = () => { const abc = validateAbcProfile(abcDirections); const missing = Object.entries(values).filter(([, value]) => !value.trim()).map(([key]) => key); const all = [...abc.errors.map((error) => error.message), ...missing]; setErrors(all); if (!all.length) onNotify("Новая неизменяемая версия профиля сохранена"); };
  return <div className="settings-content"><aside>{[...Object.keys(values), "ABC-профиль"].map((item) => <button key={item} className={activeRule === item ? "active" : ""} onClick={() => setActiveRule(item)}>{item}</button>)}</aside><section><div className="settings-intro"><div><p className="eyebrow">Параметры оценки</p><h3>{activeRule}</h3></div></div>{errors.length > 0 && <div className="abc-validation-summary" role="alert">{errors.join(" · ")}</div>}{activeRule === "ABC-профиль" ? <div className="abc-direction-editor"><div className="abc-direction-summary"><div><b>ABC-направления</b><p>Наблюдаемые определения A, B и C.</p></div><span>{abcDirections.length}</span></div>{abcDirections.map((direction, index) => <article className="abc-direction-card" key={direction.id}><header><div><span className="direction-order">{index + 1}</span></div><button onClick={() => setAbcDirections((items) => items.filter((item) => item.id !== direction.id))}>Удалить</button></header><label className="direction-name"><span>Название</span><input value={direction.name} onChange={(event) => setAbcDirections((items) => items.map((item) => item.id === direction.id ? { ...item, name: event.target.value } : item))} /></label><div className="abc-grade-grid">{(["gradeA", "gradeB", "gradeC"] as const).map((field, gradeIndex) => <label key={field}><span className={`grade-mark grade-${"abc"[gradeIndex]}`}>{"ABC"[gradeIndex]}</span><textarea value={direction[field]} onChange={(event) => setAbcDirections((items) => items.map((item) => item.id === direction.id ? { ...item, [field]: event.target.value } : item))} /></label>)}</div></article>)}<div className="settings-actions"><button className="secondary-button" onClick={() => setAbcDirections(createStandardAbcDirections())}>Сбросить настройки</button><button className="secondary-button" onClick={() => setAbcDirections((items) => [...items, { id: `custom-${Date.now()}`, name: "", gradeA: "", gradeB: "", gradeC: "", origin: "custom" }])}>＋ Добавить направление</button><button className="save-button" onClick={save}>Сохранить новую версию</button></div></div> : <><label className="settings-field"><span>Правила и наблюдаемые признаки</span><textarea value={values[activeRule] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [activeRule]: event.target.value }))} rows={10} /></label><div className="settings-actions"><button className="save-button" onClick={save}>Сохранить новую версию</button></div></>}</section></div>;
}

void VacancySettingsDraft;

export function VacancySettings({ vacancy, onNotify }: { vacancy: UiVacancy; onNotify: (message: string) => void }) {
  const [activeRule, setActiveRule] = useState("Образ результата");
  const [version, setVersion] = useState<number>(vacancy.version);
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...vacancy.profile }));
  const [abcDirections, setAbcDirections] = useState<AbcProfileDirection[]>(() => vacancy.abcDirections.map((direction) => ({ ...direction })));
  const [abcErrors, setAbcErrors] = useState<readonly AbcProfileValidationError[]>([]);
  const sections = ["Образ результата", "ABC-критерии", "Компетенции", "Стоп-факторы", "Допуск к КЕ"];
  const updateDirection = (id: string, field: AbcDirectionField, value: string) => { const next = abcDirections.map((item) => item.id === id ? { ...item, [field]: value } : item); setAbcDirections(next); if (abcErrors.length) setAbcErrors(validateAbcProfile(next).errors); };
  const removeAbcDirection = (id: string) => { const next = abcDirections.filter((item) => item.id !== id); setAbcDirections(next); if (abcErrors.length) setAbcErrors(validateAbcProfile(next).errors); };
  const save = () => { const validation = validateAbcProfile(abcDirections); if (!validation.valid) { setAbcErrors(validation.errors); onNotify(validation.errors[0].message); return; } setAbcErrors([]); const next = version + 1; setVersion(next); onNotify(`Профиль вакансии сохранён как версия ${next}`); };
  const errorFor = (directionId: string, field: AbcDirectionField) => abcErrors.find((error) => error.level !== "collection" && error.directionId === directionId && error.field === field);
  const errorId = (directionId: string, field: AbcDirectionField) => `abc-${directionId.replace(/[^a-zA-Z0-9_-]/g, "-")}-${field}-error`;
  const collectionError = abcErrors.find((error) => error.level === "collection");
  return <div className="settings-content"><aside>{sections.map((item) => <button key={item} className={activeRule === item ? "active" : ""} onClick={() => setActiveRule(item)}>{item}<span>›</span></button>)}</aside><section><div className="settings-intro"><div><p className="eyebrow">{vacancy.title} · версия {version}</p><h3>{activeRule}</h3><p>Изменения применяются только к новым запускам после сохранения версии.</p></div></div>{activeRule === "ABC-критерии" ? <div className="abc-direction-editor"><div className="abc-direction-summary"><div><b>Направления оценки</b><p>Наблюдаемые определения A, B и C.</p></div><span>{abcDirections.length}</span></div>{collectionError && <div className="abc-validation-summary" role="alert">{collectionError.message}</div>}<div className="abc-direction-list">{abcDirections.map((direction, index) => { const nameError = errorFor(direction.id, "name"); return <article className="abc-direction-card" key={direction.id}><header><div><span className="direction-order">{index + 1}</span><em>{direction.origin === "standard" ? "Стандартное" : "Добавлено HR"}</em></div><button onClick={() => removeAbcDirection(direction.id)}>Удалить</button></header><label className="direction-name"><span>Название направления</span><input value={direction.name} onChange={(event) => updateDirection(direction.id, "name", event.target.value)} aria-invalid={Boolean(nameError)} aria-describedby={nameError ? errorId(direction.id, "name") : undefined} />{nameError && <span className="abc-field-error" id={errorId(direction.id, "name")} role="alert">{nameError.message}</span>}</label><div className="abc-grade-grid">{(["A", "B", "C"] as const).map((grade) => { const field = `grade${grade}` as "gradeA" | "gradeB" | "gradeC"; const fieldError = errorFor(direction.id, field); return <label key={grade}><span className={`grade-mark grade-${grade.toLowerCase()}`}>{grade}</span><textarea value={direction[field]} onChange={(event) => updateDirection(direction.id, field, event.target.value)} aria-invalid={Boolean(fieldError)} aria-describedby={fieldError ? errorId(direction.id, field) : undefined} />{fieldError && <span className="abc-field-error" id={errorId(direction.id, field)} role="alert">{fieldError.message}</span>}</label>; })}</div></article>; })}</div>{abcDirections.length === 0 && <div className="abc-empty-state"><b>Направлений пока нет</b></div>}<div className="settings-actions"><button className="secondary-button" onClick={() => setAbcDirections(createStandardAbcDirections())}>Сбросить настройки</button><button className="secondary-button" onClick={() => setAbcDirections((items) => [...items, { id: `custom-${Date.now()}`, name: "Новое направление", gradeA: "", gradeB: "", gradeC: "", origin: "custom" }])}>＋ Добавить направление</button><button className="save-button" onClick={save}>Сохранить новую версию</button></div></div> : <><label className="settings-field"><span>Правила и наблюдаемые признаки</span><textarea value={values[activeRule] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [activeRule]: event.target.value }))} rows={10} /></label><div className="settings-actions"><button className="save-button" onClick={save}>Сохранить новую версию</button></div></>}</section></div>;
}

function CreateVacancy({ existing, onClose, onCreated }: { existing: VacancyCreateState; onClose: () => void; onCreated: (state: VacancyCreateState) => void }) {
  const [step, setStep] = useState<1 | 2>(1); const [title, setTitle] = useState(""); const [profile, setProfile] = useState<Record<string, string>>(() => structuredClone(DEFAULT_PROFILE)); const [directions, setDirections] = useState(createStandardAbcDirections); const [error, setError] = useState("");
  const [operationId] = useState(() => crypto.randomUUID()); const [saving, setSaving] = useState(false);
  const close = () => { if (step === 1 || window.confirm("Удалить несохранённые изменения?")) onClose(); };
  const next = async () => {
    const message = validateVacancyTitle(title, existing.vacancies);
    setError(message ?? "");
    if (message) return;
    try {
      const response = await fetch("/api/vacancies/validate-title", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Проверка названия недоступна");
      setStep(2);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Проверка названия недоступна");
    }
  };
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/vacancies", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operationId, title, profile, abcDirections: directions, templateVersion: "abc-standard-v1" }) });
      const payload = await response.json() as { vacancy?: VacancyRecord; error?: string };
      if (!response.ok || !payload.vacancy) throw new Error(payload.error ?? "Не удалось сохранить вакансию");
      const vacancy = { ...payload.vacancy, short: payload.vacancy.title, avatar: payload.vacancy.title.slice(0, 2).toUpperCase(), color: "#58dfc4" } satisfies UiVacancy;
      onCreated({ vacancies: [...existing.vacancies, vacancy], operationBindings: { ...existing.operationBindings, [operationId]: { vacancyId: vacancy.id, folderId: vacancy.driveFolderId } } });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить вакансию");
    } finally {
      setSaving(false);
    }
  };
  return <div className="modal-backdrop" role="presentation"><section className="create-vacancy-modal panel" role="dialog" aria-modal="true" aria-labelledby="create-title"><header><div><p className="eyebrow">Шаг {step} из 2</p><h2 id="create-title">Новая вакансия</h2></div><button onClick={close} aria-label="Закрыть">×</button></header>{error && <div className="abc-validation-summary" role="alert">{error}</div>}{step === 1 ? <><label className="settings-field"><span>Название вакансии *</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label><div className="settings-actions"><button className="secondary-button" onClick={close}>Отмена</button><button className="primary-button" onClick={() => void next()}>Продолжить</button></div></> : <><div className="create-grid">{Object.keys(profile).map((key) => <label className="settings-field" key={key}><span>{key} *</span><textarea rows={3} value={profile[key]} onChange={(event) => setProfile((current) => ({ ...current, [key]: event.target.value }))} /></label>)}</div><div className="abc-direction-summary"><div><b>Стандартный ABC-профиль</b><p>Версия abc-standard-v1 · {directions.length} направлений · без LLM-генерации</p></div></div><div className="settings-actions"><button className="secondary-button" disabled={saving} onClick={() => { if (window.confirm("Вернуть стандартные параметры?")) { setProfile(structuredClone(DEFAULT_PROFILE)); setDirections(createStandardAbcDirections()); } }}>Сбросить настройки</button><button className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? "Сохраняем…" : "Сохранить вакансию"}</button></div></>}</section></div>;
}

function Candidates({ items, vacancies, onOpen, dashboardFilter, onClearDashboardFilter }: { items: UiCandidate[]; vacancies: UiVacancy[]; onOpen: (id: number) => void; dashboardFilter: QueueFilter; onClearDashboardFilter: () => void }) {
  const [filter, setFilter] = useState("ACTIVE"); const [vacancyId, setVacancyId] = useState("ALL");
  const matchesDashboardFilter = (candidate: UiCandidate) => {
    if (!dashboardFilter) return true;
    if (dashboardFilter.kind === "archive") return candidate.archived;
    if (dashboardFilter.kind === "recommendation") return dashboardFilter.candidateIds.includes(candidate.id);
    return candidate.status === dashboardFilter.status;
  };
  const archiveMode = filter === "ARCHIVE" || dashboardFilter?.kind === "archive";
  const shown = items.filter((candidate) => (archiveMode ? candidate.archived : !candidate.archived && (filter === "ACTIVE" || candidate.status === filter)) && (vacancyId === "ALL" || candidate.vacancyId === vacancyId) && matchesDashboardFilter(candidate));
  const dashboardFilterLabel = dashboardFilter?.kind === "recommendation" ? `${dashboardFilter.recommendation} · ${dashboardFilter.period} дней` : dashboardFilter?.kind === "archive" ? "Архив" : dashboardFilter ? WORKFLOW_STATUS[dashboardFilter.status] : "";
  return <div className="page candidates-page"><section className="page-title"><div><p className="breadcrumb">Рабочее пространство / Кандидаты</p><h1>Все кандидаты</h1><p>Workflow status и актуальные результаты без кадрового pipeline.</p></div></section><section className="panel candidates-panel"><div className="candidate-toolbar"><div className="candidate-filters">{[["ACTIVE", "Все"], ...Object.entries(WORKFLOW_STATUS), ["ARCHIVE", "Архив"]].map(([key, label]) => <button key={key} className={filter === key || (key === "ARCHIVE" && dashboardFilter?.kind === "archive") ? "active" : ""} onClick={() => { setFilter(key); onClearDashboardFilter(); }}>{label}</button>)}</div><label className="vacancy-filter"><span>Вакансия</span><select value={vacancyId} onChange={(event) => setVacancyId(event.target.value)}><option value="ALL">Все вакансии</option>{vacancies.map((vacancy) => <option key={vacancy.id} value={vacancy.id}>{vacancy.title}</option>)}</select></label></div>{dashboardFilter && <div className="dashboard-queue-filter" role="status"><span>Фильтр dashboard: <b>{dashboardFilterLabel}</b></span><button onClick={onClearDashboardFilter}>Показать всех</button></div>}<div className="candidate-card-grid">{shown.map((candidate) => <article className="candidate-card" key={candidate.id}><button className="candidate-card-hit" onClick={() => onOpen(candidate.id)} aria-label={`Открыть карточку ${candidate.name}`} /><div className="candidate-card-top"><span className={`avatar large ${candidate.tone}`}>{candidate.initials}</span><StatusPill status={candidate.status} archived={candidate.archived} /></div><h3>{candidate.name}</h3><p>{candidate.vacancy}</p><div className="candidate-score"><span><small>Текущий этап</small><b>{WORKFLOW_STATUS[candidate.status]}</b></span></div><footer><span>{candidate.result?.recommendation ?? candidate.failureReason ?? "Результат ещё не опубликован"}</span></footer></article>)}</div>{!shown.length && <div className="empty-state">{archiveMode ? "В архиве кандидатов нет." : "По выбранным фильтрам кандидатов нет."}</div>}</section></div>;
}

function CandidateDetail({ candidate, onBack, onArchive, onRestore, onDelete, onReprocess, onPreview }: { candidate: UiCandidate; onBack: () => void; onArchive: () => void; onRestore: () => void; onDelete: () => void; onReprocess: () => void; onPreview: (preview: Preview) => void }) {
  const [tab, setTab] = useState("AI-обзор"); const ready = validateResultPair(candidate); const processing = isProcessingStatus(candidate.status) || candidate.status === "WAITING_FOR_STABILITY";
  return <div className="page candidate-detail-page"><button className="back-button" onClick={onBack}>← Назад к списку</button><section className="candidate-hero panel"><div className="candidate-identity"><span className={`avatar xlarge ${candidate.tone}`}>{candidate.initials}</span><div><StatusPill status={candidate.status} archived={candidate.archived} /><h1>{candidate.name}</h1><p>{candidate.vacancy}</p></div></div><div className="hero-score"><div><small>Текущий workflow status</small><h2>{WORKFLOW_STATUS[candidate.status]}</h2><p>{candidate.status === "FAILED" ? `${candidate.failedStage}: ${candidate.failureReason}` : candidate.result?.recommendation ?? "Результат появится после успешной обработки"}</p></div></div><div className="hero-actions">{!candidate.archived && <button className="secondary-button" disabled={!canReprocess(candidate)} title={processing ? "Повтор будет доступен после завершения текущего запуска" : undefined} onClick={onReprocess}>↻ Повторная обработка</button>}{candidate.archived ? <><button className="secondary-button" onClick={onRestore}>Восстановить</button><button className="danger-button" onClick={onDelete}>Удалить окончательно</button></> : <button className="danger-button" disabled={!canArchive(candidate)} title={!canArchive(candidate) ? "Архивирование доступно после завершения обработки" : undefined} onClick={onArchive}>В архив</button>}</div></section>{ready ? <><section className="candidate-tabs">{["AI-обзор", "Транскрипция"].map((item) => <button key={item} onClick={() => setTab(item)} className={tab === item ? "active" : ""}>{item}</button>)}</section>{tab === "AI-обзор" ? <section className="candidate-overview"><article className="panel ai-summary"><p className="eyebrow">Актуальная версия v{String(candidate.result!.version).padStart(4, "0")}</p><h2>{candidate.result!.recommendation}</h2><p className="lead">{candidate.result!.summary}</p></article><MaterialsPanel candidate={candidate} onPreview={onPreview} /></section> : <TranscriptTab />}</> : <section className="processing-detail"><article className="panel process-status-card"><h2>{WORKFLOW_STATUS[candidate.status]}</h2><p>{candidate.status === "FAILED" ? "Автоматические повторы завершены. Можно запустить повтор вручную." : "Текущий запуск отображается как основной; прежние результаты недоступны."}</p><p>{candidate.etaMinutes === null ? "Недостаточно данных для прогноза" : `Примерно ${candidate.etaMinutes} мин`}</p></article><MaterialsPanel candidate={candidate} onPreview={onPreview} /></section>}</div>;
}

function MaterialsPanel({ candidate, onPreview }: { candidate: UiCandidate; onPreview: (preview: Preview) => void }) {
  const files = [["▧", `Резюме ${candidate.name}.pdf`, "PDF · обработано"], ["▶", "Интервью.mp4", candidate.status === "TRANSCRIBING" ? "Транскрибируется" : "Видео"], ["▤", "Заметки рекрутера.docx", "Документ"]]; const pairReady = validateResultPair(candidate);
  return <article className="panel sources-panel materials-compact"><div className="panel-head"><div><p className="eyebrow">Google Shared Drive</p><h2>Материалы</h2></div></div>{files.map((file) => <div key={file[1]}><span>{file[0]}</span><p><b>{file[1]}</b><small>{file[2]}</small></p></div>)}{pairReady && <div className="result-materials"><p><b>Результаты</b><small>Актуальная версия v{String(candidate.result!.version).padStart(4, "0")}</small></p><button onClick={() => onPreview({ candidateId: candidate.id, type: "candidate-results", version: candidate.result!.version, title: "Итоги" })}>Итоги</button><button onClick={() => onPreview({ candidateId: candidate.id, type: "abc-test", version: candidate.result!.version, title: "ABC-тест" })}>ABC-тест</button></div>}</article>;
}

function PdfPreview({ preview, onClose }: { preview: NonNullable<Preview>; onClose: () => void }) {
  const url = `/api/results?candidate=${preview.candidateId}&type=${preview.type}&version=${preview.version}`;
  const invalid = !preview.candidateId || !preview.version;
  const [state, setState] = useState<"loading" | "ready" | "error">(invalid ? "error" : "loading");
  const [objectUrl, setObjectUrl] = useState("");
  useEffect(() => {
    if (invalid) return;
    const controller = new AbortController();
    let allocated = "";
    void fetch(url, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok || response.headers.get("content-type")?.split(";", 1)[0] !== "application/pdf") throw new Error("PDF unavailable");
      allocated = URL.createObjectURL(await response.blob());
      setObjectUrl(allocated);
      setState("ready");
    }).catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => { controller.abort(); if (allocated) URL.revokeObjectURL(allocated); };
  }, [invalid, url]);
  return <div className="modal-backdrop"><section className="pdf-modal" role="dialog" aria-modal="true" aria-label={`Просмотр документа ${preview.title}`}><header><div><p className="eyebrow">Read-only · v{String(preview.version).padStart(4, "0")}</p><h2>{preview.title}</h2></div><div>{state !== "error" && <a className="secondary-button" href={`${url}&download=1`}>Скачать {preview.title}</a>}<button onClick={onClose} aria-label="Закрыть">×</button></div></header>{state === "error" ? <div className="preview-error" role="alert">Документ временно недоступен. <button onClick={onClose}>Закрыть</button></div> : <div className="preview-frame">{state === "loading" && <div className="preview-loading" role="status">Загружаем проверенный PDF…</div>}<iframe title={preview.title} src={state === "ready" ? objectUrl : url} /></div>}</section></div>;
}

function TranscriptTab() { const [search, setSearch] = useState(""); const rows = [["26:14", "HR", "Расскажите о самом сложном изменении."], ["26:32", "Кандидат", "Я начала с аудита процессов и интервью с командой."]]; return <section className="tab-panel panel transcript"><div className="panel-head"><h2>Транскрипция</h2><label className="transcript-search">⌕ <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по тексту" /></label></div>{rows.filter((row) => row.join(" ").toLowerCase().includes(search.toLowerCase())).map((row) => <article key={row[0]}><time>{row[0]}</time><b>{row[1]}</b><p>{row[2]}</p></article>)}</section>; }
