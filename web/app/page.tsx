"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type AbcDirectionField,
  type AbcProfileDirection,
  type AbcProfileValidationError,
  validateAbcProfile,
} from "./abc-profile-validation";

type View = "dashboard" | "vacancies" | "candidates" | "candidate";
type CandidateStatus = "Готов" | "Анализируется" | "Транскрибация" | "Проверка файлов" | "Нужны материалы" | "Новое" | "В архиве";

type Candidate = {
  id: number;
  name: string;
  initials: string;
  vacancy: string;
  score: number | null;
  status: CandidateStatus;
  updated: string;
  recommendation: string;
  tone: string;
  stage: string;
  stageIndex: number;
  progress: number;
  elapsedMinutes: number;
  etaMinutes: number | null;
};

type Vacancy = {
  title: string;
  short: string;
  avatar: string;
  candidates: number;
  ready: number;
  progress: number;
  color: string;
  status: "Активна" | "Черновик";
  version: number;
  profile: Record<string, string>;
  abcDirections: AbcDirection[];
};

type AbcDirection = AbcProfileDirection;

const STANDARD_ABC_DIRECTIONS: ReadonlyArray<AbcDirection> = [
  { id: "productivity", name: "Продуктивность", gradeA: "", gradeB: "", gradeC: "", origin: "standard" },
  { id: "initiative", name: "Инициатива", gradeA: "", gradeB: "", gradeC: "", origin: "standard" },
  { id: "self-learning", name: "Самообучаемость", gradeA: "", gradeB: "", gradeC: "", origin: "standard" },
  { id: "corporate-values", name: "Соответствие корпоративным ценностям", gradeA: "", gradeB: "", gradeC: "", origin: "standard" },
  { id: "autonomy", name: "Автономность", gradeA: "", gradeB: "", gradeC: "", origin: "standard" },
];

const createStandardAbcDirections = () => STANDARD_ABC_DIRECTIONS.map((direction) => ({ ...direction }));

const BUSINESS_ASSISTANT_ABC_DIRECTIONS: AbcDirection[] = [
  {
    id: "productivity",
    name: "Продуктивность",
    gradeA: "Заранее и без потерь закрывает договорённости, касания и организационные задачи.",
    gradeB: "Основные задачи выполняет в срок, отдельные детали требуют контроля.",
    gradeC: "Срывает сроки, теряет детали или оставляет важные договорённости без follow-up.",
    origin: "standard",
  },
  {
    id: "initiative",
    name: "Инициатива",
    gradeA: "Предугадывает потребности собственника и действует до напоминания.",
    gradeB: "Предлагает улучшения, но чаще работает после постановки задачи.",
    gradeC: "Ждёт подробных указаний и не реагирует заранее на очевидные риски.",
    origin: "standard",
  },
  {
    id: "self-learning",
    name: "Самообучаемость",
    gradeA: "Быстро осваивает новый контекст, людей и инструменты самостоятельно.",
    gradeB: "Осваивает новое с периодическими пояснениями и поддержкой.",
    gradeC: "Медленно адаптируется и повторяет ошибки без извлечения выводов.",
    origin: "standard",
  },
  {
    id: "corporate-values",
    name: "Соответствие корпоративным ценностям",
    gradeA: "Коммуницирует тактично, конфиденциально и без репутационных рисков.",
    gradeB: "В целом корректен, но не всегда учитывает контекст и формат общения.",
    gradeC: "Допускает неуместную коммуникацию, нарушения конфиденциальности или репутационные риски.",
    origin: "standard",
  },
  {
    id: "autonomy",
    name: "Автономность",
    gradeA: "Самостоятельно приносит 1–3 сравненных решения и рекомендует лучший вариант.",
    gradeB: "Решает типовые задачи, в сложных случаях нуждается в выборе руководителя.",
    gradeC: "Приносит проблемы без вариантов и требует постоянного контроля.",
    origin: "standard",
  },
];

const DEFAULT_VACANCY_PROFILE: Record<string, string> = {
  "Основное": "Руководитель отвечает за устойчивую работу функции и измеримый результат команды.",
  "Компетенции": "Управление командой; системное мышление; инициативность; автономность.",
  "Стоп-факторы": "Нет управленческого опыта; отказ от обязательного офисного формата.",
  "Допуск к КЕ": "Обязательный опыт подтверждён; нет стоп-факторов; ключевые компетенции подтверждены.",
};

const BUSINESS_ASSISTANT_PROFILE: Record<string, string> = {
  "Основное": "Главная задача роли — сделать так, чтобы ни одна важная коммуникация собственника не происходила случайно, поздно или без контекста. Нужные люди получают правильное внимание в нужный момент и в подходящем формате, а собственнику не нужно помнить и вручную держать весь контур отношений.\n\nФормат работы: готовность к задачам в Москве и быстрое включение офлайн при необходимости. Позиция не предполагает фиксированную удалёнку и стерильно стабильный график.",
  "Образ результата": "• У помощника есть актуальная карта окружения собственника: кто есть кто, контекст отношений, значимые даты, договорённости и предпочтительный формат коммуникации.\n• Поздравления, встречи, подарки, касания и follow-up готовятся заранее, а не в последний момент.\n• Собственник получает сообщения и предложения в исчерпывающем виде — без серии уточняющих вопросов.\n• По возникающим задачам помощник приносит не проблему, а 1–3 оптимальных решения с учётом цены, качества, сроков и времени собственника.\n• Коммуникация от лица или в интересах собственника корректная, приятная, контекстная и не создаёт репутационных рисков.\n• Помощник готов к задачам в Москве и при необходимости быстро включается офлайн.",
  "Компетенции": "1. Коммуникация и эмпатия\nБыстро понимает человека и контекст отношений, умеет говорить и писать уместно, создаёт приятное впечатление.\nДоказательства: кейсы коммуникации с собственниками, партнёрами и VIP-контактами; реальные сообщения и сценарии; рекомендации.\n\n2. Исчерпывающая передача информации\nФормулирует сообщение так, чтобы руководителю не пришлось вытягивать детали серией вопросов.\nДоказательства: кейсы подготовки решений и саммари; тестовое задание; ответы на интервью.\n\n3. Управление окружением и проактивность\nЗапоминает договорённости, строит систему контактов, дат и касаний, действует заранее.\nДоказательства: ведение базы контактов и календаря касаний; предотвращённые заранее проблемы; действия без напоминания.\n\n4. Поиск оптимальных решений\nСравнивает цену, качество, сроки и риски и приносит обоснованную рекомендацию.\nДоказательства: нестандартные кейсы по логистике, подаркам, подрядчикам, организации и срочным задачам.",
  "Стоп-факторы": "Не готовы к работе в Москве и быстрому офлайн-включению; рассматривают только фиксированную удалёнку или исключительно стабильный график.",
  "Допуск к КЕ": "Подтверждены четыре ключевые компетенции; кандидат готов к московскому и гибкому формату работы; нет подтверждённых репутационных рисков в коммуникации.",
};

const candidates: Candidate[] = [
  { id: 1, name: "Анна Воронцова", initials: "АВ", vacancy: "Руководитель юридического департамента", score: 92, status: "Готов", updated: "12 мин назад", recommendation: "Сильное соответствие", tone: "pink", stage: "Анализ завершён", stageIndex: 6, progress: 100, elapsedMinutes: 17, etaMinutes: 0 },
  { id: 2, name: "Михаил Сергеев", initials: "МС", vacancy: "Руководитель юридического департамента", score: null, status: "Анализируется", updated: "обновлено 20 сек назад", recommendation: "AI формирует выводы", tone: "blue", stage: "AI-анализ", stageIndex: 4, progress: 68, elapsedMinutes: 12, etaMinutes: 6 },
  { id: 3, name: "Елена Кравцова", initials: "ЕК", vacancy: "Финансовый директор", score: null, status: "Новое", updated: "обнаружена 1 мин назад", recommendation: "Кандидат подхвачен", tone: "orange", stage: "Обнаружен на Google Drive", stageIndex: 1, progress: 8, elapsedMinutes: 1, etaMinutes: 17 },
  { id: 4, name: "Денис Морозов", initials: "ДМ", vacancy: "Финансовый директор", score: null, status: "Нужны материалы", updated: "2 часа назад", recommendation: "Нет записи интервью", tone: "mint", stage: "Ожидает файл интервью", stageIndex: 1, progress: 12, elapsedMinutes: 2, etaMinutes: null },
  { id: 5, name: "Ирина Павлова", initials: "ИП", vacancy: "Операционный директор", score: 89, status: "Готов", updated: "Вчера, 18:42", recommendation: "Сильное соответствие", tone: "violet", stage: "Анализ завершён", stageIndex: 6, progress: 100, elapsedMinutes: 19, etaMinutes: 0 },
  { id: 6, name: "Алексей Руднев", initials: "АР", vacancy: "Product Lead", score: 76, status: "Готов", updated: "Вчера, 16:10", recommendation: "Соответствие с рисками", tone: "blue", stage: "Анализ завершён", stageIndex: 6, progress: 100, elapsedMinutes: 21, etaMinutes: 0 },
  { id: 7, name: "Ольга Смолина", initials: "ОС", vacancy: "Руководитель юридического департамента", score: null, status: "Транскрибация", updated: "обновлено 8 сек назад", recommendation: "Распознано 31 из 58 минут", tone: "mint", stage: "Транскрибация интервью", stageIndex: 3, progress: 47, elapsedMinutes: 7, etaMinutes: 11 },
  { id: 8, name: "Павел Корнеев", initials: "ПК", vacancy: "Финансовый директор", score: null, status: "Проверка файлов", updated: "обнаружен 2 мин назад", recommendation: "Проверяется комплектность", tone: "orange", stage: "Проверка материалов", stageIndex: 2, progress: 19, elapsedMinutes: 2, etaMinutes: 16 },
  { id: 9, name: "Наталья Лебедева", initials: "НЛ", vacancy: "Руководитель юридического департамента", score: 86, status: "Готов", updated: "Сегодня, 09:18", recommendation: "Соответствие с рисками", tone: "violet", stage: "Анализ завершён", stageIndex: 6, progress: 100, elapsedMinutes: 20, etaMinutes: 0 },
];

const vacancies: Vacancy[] = [
  { title: "Руководитель юридического департамента", short: "Руководитель ЮД", avatar: "ЮД", candidates: 9, ready: 3, progress: 68, color: "#ff98d8", status: "Активна", version: 3, profile: DEFAULT_VACANCY_PROFILE, abcDirections: createStandardAbcDirections() },
  { title: "Финансовый директор", short: "Финансовый директор", avatar: "ФД", candidates: 7, ready: 2, progress: 52, color: "#ffc56b", status: "Активна", version: 3, profile: DEFAULT_VACANCY_PROFILE, abcDirections: createStandardAbcDirections() },
  { title: "Операционный директор", short: "Операционный директор", avatar: "ОД", candidates: 4, ready: 3, progress: 81, color: "#58dfc4", status: "Активна", version: 3, profile: DEFAULT_VACANCY_PROFILE, abcDirections: createStandardAbcDirections() },
  { title: "Product Lead", short: "Product Lead", avatar: "PL", candidates: 3, ready: 1, progress: 35, color: "#87a9ff", status: "Черновик", version: 3, profile: DEFAULT_VACANCY_PROFILE, abcDirections: createStandardAbcDirections() },
  { title: "Бизнес-ассистент", short: "Бизнес-ассистент", avatar: "БА", candidates: 0, ready: 0, progress: 0, color: "#a78bfa", status: "Черновик", version: 1, profile: BUSINESS_ASSISTANT_PROFILE, abcDirections: BUSINESS_ASSISTANT_ABC_DIRECTIONS },
];

const candidateFlow = [
  { day: "Пн", date: "10 авг", counts: [2, 1, 1, 0] },
  { day: "Вт", date: "11 авг", counts: [3, 2, 1, 1] },
  { day: "Ср", date: "12 авг", counts: [1, 2, 2, 1] },
  { day: "Чт", date: "13 авг", counts: [4, 2, 1, 1] },
  { day: "Пт", date: "14 авг", counts: [3, 3, 2, 1] },
  { day: "Сб", date: "15 авг", counts: [1, 1, 1, 0] },
  { day: "Вс", date: "16 авг", counts: [2, 1, 1, 1] },
];

const nav: { id: View; label: string; icon: string }[] = [
  { id: "dashboard", label: "Дашборд", icon: "⌘" },
  { id: "vacancies", label: "Вакансии", icon: "▤" },
  { id: "candidates", label: "Кандидаты", icon: "♙" },
];

const processingStatuses: CandidateStatus[] = ["Новое", "Проверка файлов", "Транскрибация", "Анализируется"];
const isProcessing = (candidate: Candidate) => processingStatuses.includes(candidate.status);

function StatusPill({ status }: { status: CandidateStatus }) {
  return <span className={`status status-${status.toLowerCase().replaceAll(" ", "-")}`}><i />{status}</span>;
}

export default function Home() {
  const [view, setView] = useState<View>("dashboard");
  const [previousView, setPreviousView] = useState<View>("dashboard");
  const [selectedCandidate, setSelectedCandidate] = useState(1);
  const [toast, setToast] = useState("");
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [archivedIds, setArchivedIds] = useState<number[]>([]);
  const [scanCountdown, setScanCountdown] = useState(15);
  const [lastScan, setLastScan] = useState("только что");

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("hrconnect-theme");
    const preferredTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    const initialTheme = savedTheme === "dark" || savedTheme === "light" ? savedTheme : preferredTheme;
    setTheme(initialTheme);
    document.documentElement.dataset.theme = initialTheme;
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setScanCountdown((current) => {
        if (current <= 1) {
          setLastScan(new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
          return 15;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const displayCandidates = useMemo(() => candidates.map((candidate) => archivedIds.includes(candidate.id) ? { ...candidate, status: "В архиве" as CandidateStatus, stage: "Перемещён в архив", progress: 100 } : candidate), [archivedIds]);
  const matchingCandidates = useMemo(() => displayCandidates.filter((candidate) => `${candidate.name} ${candidate.vacancy}`.toLowerCase().includes(query.toLowerCase())), [displayCandidates, query]);

  const toggleTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("hrconnect-theme", nextTheme);
  };

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };

  const openCandidate = (id: number) => {
    setPreviousView(view === "candidate" ? "candidates" : view);
    setSelectedCandidate(id);
    setView("candidate");
  };

  const archiveCandidate = (id: number) => {
    setArchivedIds((current) => current.includes(id) ? current : [...current, id]);
    setView("candidates");
    notify("Кандидат перемещён в архив");
  };

  const activeNav = view === "candidate" ? "candidates" : view;
  return (
    <main className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setView("dashboard")} aria-label="На главную"><span className="brand-mark"><img src="/company-logo.png" alt="" /></span><span><b>Правильный выбор</b><small>AI talent intelligence</small></span></button>
        <nav className="main-nav" aria-label="Основная навигация">{nav.map((item) => <button key={item.id} className={activeNav === item.id ? "active" : ""} onClick={() => setView(item.id)}><span>{item.icon}</span>{item.label}</button>)}<button onClick={() => notify("Аналитика качества обработки появится на следующем этапе")}><span>⌁</span>Аналитика</button></nav>
        <div className="top-actions"><label className="global-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" /></label><button className="theme-toggle" onClick={toggleTheme} aria-label={theme === "light" ? "Включить тёмную тему" : "Включить светлую тему"} title={theme === "light" ? "Тёмная тема" : "Светлая тема"}><span aria-hidden="true">{theme === "light" ? "☾" : "☀"}</span></button><button className="round-button" onClick={() => notify("3 кандидата требуют внимания")} aria-label="Уведомления">♢<i /></button><button className="profile" onClick={() => notify("Профиль Алсу Салямовой")}><span className="avatar avatar-owner">АС</span><span><b>Алсу Салямова</b><small>HR-директор</small></span></button></div>
      </header>
      {view === "dashboard" && <Dashboard candidates={displayCandidates} scanCountdown={scanCountdown} lastScan={lastScan} onOpenCandidate={openCandidate} onNavigate={setView} onNotify={notify} />}
      {view === "vacancies" && <Vacancies candidates={displayCandidates} onOpenCandidate={openCandidate} onNotify={notify} />}
      {view === "candidates" && <Candidates items={matchingCandidates} onOpenCandidate={openCandidate} onNotify={notify} />}
      {view === "candidate" && <CandidateDetail candidate={displayCandidates.find((candidate) => candidate.id === selectedCandidate) ?? displayCandidates[0]} onBack={() => setView(previousView)} onArchive={archiveCandidate} onNotify={notify} />}
      {toast && <div className="toast" role="status">✓ {toast}</div>}
    </main>
  );
}

function Dashboard({ candidates: items, scanCountdown, lastScan, onOpenCandidate, onNavigate, onNotify }: { candidates: Candidate[]; scanCountdown: number; lastScan: string; onOpenCandidate: (id: number) => void; onNavigate: (view: View) => void; onNotify: (message: string) => void }) {
  const processing = items.filter(isProcessing);
  return <div className="page dashboard-page">
    <section className="welcome-row"><div><p className="breadcrumb">Рабочее пространство / Дашборд</p><h1>Доброе утро, Алсу!</h1><p>Новые кандидаты появляются здесь автоматически после создания папки на Google Drive.</p></div><div className="drive-monitor"><span className="live-dot" />Google Drive подключён<small>Следующая проверка через {scanCountdown} сек · последняя: {lastScan}</small></div></section>
    <section className="panel processing-panel"><div className="panel-head"><h2>Контроль очереди</h2><button onClick={() => onNavigate("candidates")}>Вся очередь →</button></div><div className="processing-grid">{processing.map((candidate) => <button className="processing-card" key={candidate.id} onClick={() => onOpenCandidate(candidate.id)}><span className={`avatar ${candidate.tone}`}>{candidate.initials}</span><span className="processing-copy"><b>{candidate.name}</b><small>{candidate.vacancy}</small><em>{candidate.stage}</em></span><span className="processing-time"><b>{candidate.etaMinutes === null ? "—" : `≈ ${candidate.etaMinutes} мин`}</b><small>{candidate.etaMinutes === null ? "ожидает материалов" : `прошло ${candidate.elapsedMinutes} мин`}</small></span><span className="progress-track"><i style={{ width: `${candidate.progress}%` }} /></span></button>)}</div></section>
    <section className="metric-grid"><button className="metric-card pink" onClick={() => onNavigate("candidates")}><span className="metric-icon">♙</span><p>Новые кандидаты</p><strong>3</strong><small>Подхвачены сегодня</small><em className="up">Проверка 15 сек</em></button><button className="metric-card orange" onClick={() => onNavigate("candidates")}><span className="metric-icon">⌁</span><p>Ожидают решения</p><strong>6</strong><small>3 — с высоким рейтингом</small><em className="urgent">Важно</em></button><button className="metric-card blue" onClick={() => onNavigate("candidates")}><span className="metric-icon">◷</span><p>В обработке</p><strong>{processing.length}</strong><small>Среднее время 18 минут</small><em className="up">Все в SLA</em></button><button className="metric-card mint" onClick={() => onNavigate("vacancies")}><span className="metric-icon">▤</span><p>Активные вакансии</p><strong>3</strong><small>23 кандидата всего</small><em className="up">+2</em></button></section>
    <section className="dashboard-grid">
      <article className="panel flow-panel"><div className="panel-head"><div><p className="eyebrow">Динамика за 7 дней</p><h2>Поток кандидатов</h2></div><button onClick={() => onNotify("Период: последние 7 дней")}>7 дней⌄</button></div><div className="bar-chart stacked-chart" aria-label="Количество прошедших кандидатов по всем вакансиям и дням">{candidateFlow.map((item) => { const total = item.counts.reduce((sum, count) => sum + count, 0); return <div className="bar-slot" key={item.day}><div className="bar-wrap grouped-wrap" aria-label={`${item.day}: всего ${total} кандидатов`}><strong className="bar-total">{total}</strong><div className="grouped-bars">{item.counts.map((count, vacancyIndex) => <span key={vacancies[vacancyIndex].title} className="vacancy-bar" style={{ height: `${Math.max(8, count * 22)}px`, background: vacancies[vacancyIndex].color, opacity: count === 0 ? .25 : 1 }} title={`${vacancies[vacancyIndex].title}: ${count}`} aria-label={`${vacancies[vacancyIndex].title}: ${count}`}><b>{count}</b></span>)}</div></div><small><b>{item.day}</b><span>{item.date}</span></small></div>; })}</div><div className="legend vacancy-legend">{vacancies.map((vacancy) => <span key={vacancy.title}><i style={{ background: vacancy.color }} />{vacancy.short}</span>)}</div></article>
      <article className="panel result-panel"><div className="panel-head"><div><p className="eyebrow">Все вакансии</p><h2>Результаты анализа</h2></div><button onClick={() => onNavigate("candidates")}>Все →</button></div><div className="donut-wrap"><div className="donut"><div><small>Готово</small><strong>19</strong></div></div></div><div className="result-legend"><span><i className="green" /><b>11</b>Сильное соответствие</span><span><i className="yellow" /><b>5</b>С рисками</span><span><i className="red" /><b>3</b>Не соответствует</span></div></article>
    </section>
  </div>;
}

function Vacancies({ candidates: items, onOpenCandidate, onNotify }: { candidates: Candidate[]; onOpenCandidate: (id: number) => void; onNotify: (message: string) => void }) {
  const [selected, setSelected] = useState(0);
  const [tab, setTab] = useState("Кандидаты");
  const vacancy = vacancies[selected];
  return <div className="page vacancies-page"><section className="page-title"><div><p className="breadcrumb">Рабочее пространство / Вакансии</p><h1>Вакансии</h1><p>Управляйте профилями оценки и отслеживайте обработку кандидатов.</p></div><button className="primary-button" onClick={() => onNotify("Создан черновик вакансии")}>＋ Новая вакансия</button></section><div className="vacancy-layout"><aside className="vacancy-sidebar panel"><div className="mini-search">⌕ <input placeholder="Найти вакансию" /></div><div className="vacancy-nav-list">{vacancies.map((item, index) => <button className={selected === index ? "active" : ""} key={item.title} onClick={() => setSelected(index)}><i style={{ background: item.color }} /><span><b>{item.short}</b><small>{item.candidates} кандидатов · {item.status.toLowerCase()}</small></span><em>{item.ready}</em></button>)}</div></aside><section className="vacancy-main panel"><header className="vacancy-header"><div className="vacancy-heading"><span className="vacancy-avatar" style={{ background: vacancy.color }}>{vacancy.avatar}</span><div><span className="soft-badge">{vacancy.status}</span><h2>{vacancy.title}</h2><p>Профиль v{vacancy.version} · обновлён сегодня</p></div></div><button className="secondary-button" onClick={() => setTab("Параметры оценки")}>⚙ Настройки</button></header><div className="vacancy-tabs">{["Кандидаты", "Параметры оценки", "Активность"].map((item) => <button key={item} onClick={() => setTab(item)} className={tab === item ? "active" : ""}>{item}</button>)}</div>{tab === "Кандидаты" ? <VacancyCandidates candidates={items.filter((candidate) => candidate.vacancy === vacancy.title)} onOpenCandidate={onOpenCandidate} /> : tab === "Параметры оценки" ? <VacancySettings key={vacancy.title} vacancy={vacancy} onNotify={onNotify} /> : <VacancyActivity />}</section></div></div>;
}

function VacancyCandidates({ candidates: items, onOpenCandidate }: { candidates: Candidate[]; onOpenCandidate: (id: number) => void }) {
  return <div className="vacancy-content"><div className="ranking-head"><div><p className="eyebrow">Рейтинг по профилю вакансии</p><h3>Кандидаты</h3></div><div className="table-tools"><button>≡ Фильтры</button><button>↥ Экспорт</button></div></div>{items.length === 0 ? <div className="vacancy-empty"><span>♙</span><b>Кандидатов пока нет</b><p>Добавьте материалы кандидата в Google Drive — он появится в этой вакансии после обработки.</p></div> : <div className="ranking-table"><div className="ranking-row labels"><span>#</span><span>Кандидат</span><span>Статус</span><span>Соответствие</span><span>Этап / время</span><span /></div>{items.map((candidate, index) => <button className="ranking-row" key={candidate.id} onClick={() => onOpenCandidate(candidate.id)}><span className="rank">{index + 1}</span><span className="candidate-cell"><i className={`avatar ${candidate.tone}`}>{candidate.initials}</i><i><b>{candidate.name}</b><small>{candidate.updated}</small></i></span><span><StatusPill status={candidate.status} /></span><span className="score-cell"><b>{candidate.score ? `${candidate.score}%` : `${candidate.progress}%`}</b><i><em style={{ width: `${candidate.score ?? candidate.progress}%` }} /></i></span><span className="risk-cell">{candidate.etaMinutes === null ? candidate.stage : candidate.etaMinutes > 0 ? `≈ ${candidate.etaMinutes} мин` : "Готово"}</span><span className="arrow">›</span></button>)}</div>}</div>;
}

function VacancySettings({ vacancy, onNotify }: { vacancy: Vacancy; onNotify: (message: string) => void }) {
  const [activeRule, setActiveRule] = useState("Основное");
  const [version, setVersion] = useState(vacancy.version);
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...vacancy.profile }));
  const [abcDirections, setAbcDirections] = useState<AbcDirection[]>(() => vacancy.abcDirections.map((direction) => ({ ...direction })));
  const [abcErrors, setAbcErrors] = useState<readonly AbcProfileValidationError[]>([]);
  const sections = ["Основное", ...(values["Образ результата"] ? ["Образ результата"] : []), "ABC-критерии", "Компетенции", "Стоп-факторы", "Допуск к КЕ"];

  const updateAbcDirection = (id: string, field: "name" | "gradeA" | "gradeB" | "gradeC", value: string) => {
    const nextDirections = abcDirections.map((direction) => direction.id === id ? { ...direction, [field]: value } : direction);
    setAbcDirections(nextDirections);
    if (abcErrors.length > 0) setAbcErrors(validateAbcProfile(nextDirections).errors);
  };

  const addAbcDirection = () => {
    const customNumber = abcDirections.filter((direction) => direction.origin === "custom").length + 1;
    const nextDirections: AbcDirection[] = [
      ...abcDirections,
      { id: `custom-${Date.now()}`, name: `Новое направление ${customNumber}`, gradeA: "", gradeB: "", gradeC: "", origin: "custom" },
    ];
    setAbcDirections(nextDirections);
    if (abcErrors.length > 0) setAbcErrors(validateAbcProfile(nextDirections).errors);
    onNotify("Добавлено новое ABC-направление");
  };

  const removeAbcDirection = (id: string) => {
    const nextDirections = abcDirections.filter((direction) => direction.id !== id);
    setAbcDirections(nextDirections);
    if (abcErrors.length > 0) setAbcErrors(validateAbcProfile(nextDirections).errors);
    onNotify("ABC-направление удалено из черновика");
  };

  const save = () => {
    const validation = validateAbcProfile(abcDirections);
    if (!validation.valid) {
      setAbcErrors(validation.errors);
      onNotify(validation.errors[0].message);
      return;
    }
    setAbcErrors([]);
    const nextVersion = version + 1;
    setVersion(nextVersion);
    onNotify(`Профиль вакансии сохранён как версия ${nextVersion}`);
  };

  const errorFor = (directionId: string, field: AbcDirectionField) => abcErrors.find(
    (error) => error.level !== "collection" && error.directionId === directionId && error.field === field,
  );
  const errorIdFor = (directionId: string, field: AbcDirectionField) => `abc-${directionId.replace(/[^a-zA-Z0-9_-]/g, "-")}-${field}-error`;
  const collectionError = abcErrors.find((error) => error.level === "collection");

  return (
    <div className="settings-content">
      <aside>{sections.map((item) => <button key={item} className={activeRule === item ? "active" : ""} onClick={() => setActiveRule(item)}>{item}<span>›</span></button>)}</aside>
      <section>
        <div className="settings-intro">
          <div><p className="eyebrow">{vacancy.title} · версия {version}</p><h3>{activeRule}</h3><p>Изменения применяются только к новым запускам анализа после сохранения версии.</p></div>
          <span className="autosave-state">Черновик сохранён</span>
        </div>

        {activeRule === "ABC-критерии" ? (
          <div className="abc-direction-editor">
            <div className="abc-direction-summary">
              <div><b>Направления оценки</b><p>Пять направлений из ТЗ добавляются в новую вакансию автоматически. HR может переименовать, удалить или дополнить их для этой вакансии.</p></div>
              <span>{abcDirections.length}</span>
            </div>

            {collectionError && <div className="abc-validation-summary" role="alert">{collectionError.message}</div>}

            <div className="abc-direction-list">
              {abcDirections.map((direction, index) => {
                const nameError = errorFor(direction.id, "name");
                return (
                <article className="abc-direction-card" key={direction.id} data-invalid={abcErrors.some((error) => error.level !== "collection" && error.directionId === direction.id) || undefined}>
                  <header>
                    <div><span className="direction-order">{index + 1}</span><em>{direction.origin === "standard" ? "Стандартное" : "Добавлено HR"}</em></div>
                    <button type="button" onClick={() => removeAbcDirection(direction.id)} aria-label={`Удалить направление ${direction.name}`}>Удалить</button>
                  </header>
                  <label className="direction-name"><span>Название направления</span><input value={direction.name} onChange={(event) => updateAbcDirection(direction.id, "name", event.target.value)} aria-invalid={Boolean(nameError)} aria-describedby={nameError ? errorIdFor(direction.id, "name") : undefined} />{nameError && <span className="abc-field-error" id={errorIdFor(direction.id, "name")} role="alert">{nameError.message}</span>}</label>
                  <div className="abc-grade-grid">
                    {(["A", "B", "C"] as const).map((grade) => {
                      const field = `grade${grade}` as "gradeA" | "gradeB" | "gradeC";
                      const fieldError = errorFor(direction.id, field);
                      return <label key={grade}><span className={`grade-mark grade-${grade.toLowerCase()}`}>{grade}</span><textarea rows={2} value={direction[field]} onChange={(event) => updateAbcDirection(direction.id, field, event.target.value)} placeholder={`Опишите наблюдаемые признаки оценки ${grade}`} aria-invalid={Boolean(fieldError)} aria-describedby={fieldError ? errorIdFor(direction.id, field) : undefined} />{fieldError && <span className="abc-field-error" id={errorIdFor(direction.id, field)} role="alert">{fieldError.message}</span>}</label>;
                    })}
                  </div>
                </article>
              );})}
            </div>

            {abcDirections.length === 0 && <div className="abc-empty-state"><b>Направлений пока нет</b><p>Добавьте направление, чтобы настроить ABC-оценку этой вакансии.</p></div>}

            <div className="rule-hint"><b>Что увидит AI</b><p>Система использует набор и признаки из той версии профиля, с которой запущен анализ. Пустые признаки A/B/C остаются незаполненными — система не придумывает их автоматически.</p></div>
            <div className="settings-actions"><button className="secondary-button" type="button" onClick={addAbcDirection}>＋ Добавить направление</button><button className="save-button" onClick={save}>Сохранить новую версию</button></div>
          </div>
        ) : (
          <>
            <label className="settings-field"><span>Правила и наблюдаемые признаки</span><textarea value={values[activeRule] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [activeRule]: event.target.value }))} rows={activeRule === "Компетенции" ? 18 : activeRule === "Образ результата" ? 10 : 6} /></label>
            <div className="rule-hint"><b>Что увидит AI</b><p>Система будет оценивать только факты, которые можно связать с резюме или таймкодом интервью. Недостаток данных не превращается в отрицательную оценку.</p></div>
            <div className="settings-actions"><button className="secondary-button" onClick={() => setValues((current) => ({ ...current, [activeRule]: `${current[activeRule] ?? ""}\nНовое правило` }))}>＋ Добавить правило</button><button className="save-button" onClick={save}>Сохранить новую версию</button></div>
          </>
        )}
      </section>
    </div>
  );
}

function VacancyActivity() {
  return <div className="activity-feed"><h3>Активность вакансии</h3>{["Анна Воронцова — анализ завершён", "Профиль оценки обновлён до версии 3", "Михаил Сергеев — начат AI-анализ", "Ольга Смолина — транскрибация 53%"].map((item, index) => <article key={item}><i>{index === 0 ? "✓" : index === 1 ? "⚙" : "＋"}</i><div><b>{item}</b><small>{index === 0 ? "12 минут назад" : `${index + 1} часа назад`}</small></div></article>)}</div>;
}

function Candidates({ items, onOpenCandidate, onNotify }: { items: Candidate[]; onOpenCandidate: (id: number) => void; onNotify: (message: string) => void }) {
  const [filter, setFilter] = useState("Все");
  const [vacancyFilter, setVacancyFilter] = useState("Все вакансии");
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const shown = items.filter((candidate) => (filter === "Все" || filter === "В обработке" ? filter === "Все" || isProcessing(candidate) : candidate.status === filter) && (vacancyFilter === "Все вакансии" || candidate.vacancy === vacancyFilter));
  const selected = items.filter((candidate) => compareIds.includes(candidate.id));
  const toggleCompare = (candidate: Candidate) => {
    if (compareIds.includes(candidate.id)) return setCompareIds((current) => current.filter((id) => id !== candidate.id));
    if (compareIds.length >= 3) return onNotify("Можно сравнить не более трёх кандидатов");
    if (selected.length && selected[0].vacancy !== candidate.vacancy) return onNotify("Сравнение доступно только внутри одной вакансии");
    setCompareIds((current) => [...current, candidate.id]);
  };
  return <div className="page candidates-page"><section className="page-title"><div><p className="breadcrumb">Рабочее пространство / Кандидаты</p><h1>Все кандидаты</h1><p>Единая очередь с контролем обработки и сравнением внутри вакансии.</p></div><div className="title-actions"><button className={`secondary-button ${compareMode ? "active-mode" : ""}`} onClick={() => { setCompareMode((current) => !current); setCompareIds([]); setCompareOpen(false); }}>⇄ {compareMode ? "Завершить сравнение" : "Сравнить"}</button><button className="primary-button" onClick={() => onNotify("Кандидаты создаются в папке вакансии на Google Drive")}>＋ Как добавить кандидата</button></div></section><section className="panel candidates-panel"><div className="candidate-toolbar"><div className="candidate-filters">{["Все", "Новое", "В обработке", "Готов", "Нужны материалы", "В архиве"].map((item) => <button className={filter === item ? "active" : ""} key={item} onClick={() => setFilter(item)}>{item}<span>{item === "Все" ? items.length : item === "В обработке" ? items.filter(isProcessing).length : items.filter((candidate) => candidate.status === item).length}</span></button>)}</div><label className="vacancy-filter"><span>Вакансия</span><select value={vacancyFilter} onChange={(event) => { setVacancyFilter(event.target.value); setCompareIds([]); }}><option>Все вакансии</option>{vacancies.map((vacancy) => <option key={vacancy.title}>{vacancy.title}</option>)}</select></label></div><div className="candidate-card-grid">{shown.map((candidate) => <article className={`candidate-card ${compareIds.includes(candidate.id) ? "selected" : ""}`} key={candidate.id}><button className="candidate-card-hit" onClick={() => onOpenCandidate(candidate.id)} aria-label={`Открыть карточку ${candidate.name}`} /><div className="candidate-card-top"><span className={`avatar large ${candidate.tone}`}>{candidate.initials}</span><StatusPill status={candidate.status} /></div><h3>{candidate.name}</h3><p>{candidate.vacancy}</p><div className="candidate-score"><span><small>{isProcessing(candidate) ? candidate.stage : "AI-соответствие"}</small><b>{candidate.score ? `${candidate.score}%` : candidate.status === "Нужны материалы" ? "Пауза" : `${candidate.progress}%`}</b></span><i><em style={{ width: `${candidate.score ?? candidate.progress}%` }} /></i></div>{isProcessing(candidate) && <div className="card-eta"><span>Прошло {candidate.elapsedMinutes} мин</span><b>Осталось ≈ {candidate.etaMinutes} мин</b></div>}<footer><span>{candidate.recommendation}</span></footer>{compareMode && candidate.status === "Готов" && <button className="compare-check" onClick={() => toggleCompare(candidate)} aria-pressed={compareIds.includes(candidate.id)}>{compareIds.includes(candidate.id) ? "✓ Добавлен" : "+ В сравнение"}</button>}</article>)}</div>{shown.length === 0 && <div className="empty-state">По выбранным фильтрам кандидатов нет.</div>}{compareMode && <div className="compare-bar"><span><b>{compareIds.length} из 3</b><small>{selected[0]?.vacancy ?? "Выберите готовых кандидатов одной вакансии"}</small></span><button disabled={compareIds.length < 2} onClick={() => setCompareOpen(true)}>Сравнить кандидатов</button></div>}{compareOpen && <Comparison candidates={selected} onClose={() => setCompareOpen(false)} />}</section></div>;
}

function Comparison({ candidates: items, onClose }: { candidates: Candidate[]; onClose: () => void }) {
  const metrics = ["Продуктивность", "Инициатива", "Автономность", "Управление командой", "Корпоративные ценности"];
  return <section className="comparison-panel" aria-label="Сравнение кандидатов"><div className="comparison-head"><div><p className="eyebrow">{items[0]?.vacancy}</p><h2>Сравнение кандидатов</h2><p>Единые критерии и результаты по одной версии профиля вакансии.</p></div><button onClick={onClose} aria-label="Закрыть сравнение">×</button></div><div className="comparison-table"><div className="comparison-row comparison-people"><span>Критерий</span>{items.map((candidate) => <span key={candidate.id}><i className={`avatar ${candidate.tone}`}>{candidate.initials}</i><b>{candidate.name}</b><small>{candidate.score}% · {candidate.recommendation}</small></span>)}</div>{metrics.map((metric, index) => <div className="comparison-row" key={metric}><strong>{metric}</strong>{items.map((candidate, candidateIndex) => { const value = Math.max(68, (candidate.score ?? 80) - index * 3 - candidateIndex * 2); return <span key={candidate.id}><b>{value}%</b><i><em style={{ width: `${value}%` }} /></i></span>; })}</div>)}</div></section>;
}

function CandidateDetail({ candidate, onBack, onArchive, onNotify }: { candidate: Candidate; onBack: () => void; onArchive: (id: number) => void; onNotify: (message: string) => void }) {
  const [tab, setTab] = useState("AI-обзор");
  const ready = candidate.status === "Готов";
  return <div className="page candidate-detail-page"><button className="back-button" onClick={onBack}>← Назад к списку</button><section className="candidate-hero panel"><div className="candidate-identity"><span className={`avatar xlarge ${candidate.tone}`}>{candidate.initials}</span><div><StatusPill status={candidate.status} /><h1>{candidate.name}</h1><p>{candidate.vacancy} · Екатеринбург</p></div></div><div className="hero-score">{ready ? <><div className="score-ring" style={{ background: `conic-gradient(#4cddbd 0 ${candidate.score}%,#eef1f3 ${candidate.score}% 100%)` }}><span><b>{candidate.score}</b><small>из 100</small></span></div><div><small>Итог AI</small><h2>{candidate.recommendation}</h2><p>Уверенность вывода 87%</p></div></> : <><div className="processing-ring"><span>{candidate.progress}%</span></div><div><small>Текущий этап</small><h2>{candidate.stage}</h2><p>{candidate.etaMinutes === null ? "Ожидаем недостающие материалы" : `Осталось примерно ${candidate.etaMinutes} мин`}</p></div></>}</div><div className="hero-actions">{ready && <button className="secondary-button" onClick={() => onNotify("Отчёт выгружен в PDF")}>↥ Скачать отчёт</button>}<button className="danger-button" onClick={() => onArchive(candidate.id)}>В архив</button>{ready && <button className="primary-button" onClick={() => onNotify("Кандидат отмечен для следующего этапа")}>На следующий этап</button>}</div></section>{ready ? <><section className="candidate-tabs">{["AI-обзор", "Транскрипция"].map((item) => <button key={item} onClick={() => setTab(item)} className={tab === item ? "active" : ""}>{item}</button>)}</section>{tab === "AI-обзор" ? <CandidateOverview candidate={candidate} onNotify={onNotify} /> : <TranscriptTab />}</> : <ProcessingDetail candidate={candidate} onNotify={onNotify} />}</div>;
}

function ProcessingDetail({ candidate, onNotify }: { candidate: Candidate; onNotify: (message: string) => void }) {
  const stages = ["Обнаружен", "Проверка файлов", "Транскрибация", "AI-анализ", "Проверка результата", "Готово"];
  return <section className="processing-detail"><article className="panel process-status-card"><div className="panel-head"><div><p className="eyebrow">Обновляется автоматически</p><h2>Ход обработки</h2></div><span className="confidence-chip">Проверка Drive каждые 15 сек</span></div><div className="stage-list">{stages.map((stage, index) => <div className={index + 1 < candidate.stageIndex ? "done" : index + 1 === candidate.stageIndex ? "active" : ""} key={stage}><i>{index + 1 < candidate.stageIndex ? "✓" : index + 1}</i><span><b>{stage}</b><small>{index + 1 < candidate.stageIndex ? "Завершено" : index + 1 === candidate.stageIndex ? candidate.updated : "Ожидает"}</small></span></div>)}</div><div className="processing-stat-grid"><span><small>Прошло</small><b>{candidate.elapsedMinutes} мин</b></span><span><small>Осталось</small><b>{candidate.etaMinutes === null ? "—" : `≈ ${candidate.etaMinutes} мин`}</b></span><span><small>Историческая медиана</small><b>18 мин</b></span><span><small>SLA</small><b className="good">В норме</b></span></div></article><MaterialsPanel candidateName={candidate.name} onNotify={onNotify} processing /></section>;
}

function CandidateOverview({ candidate, onNotify }: { candidate: Candidate; onNotify: (message: string) => void }) {
  const firstName = candidate.name.split(" ")[0];
  return <section className="candidate-overview"><div className="overview-main"><article className="panel ai-summary"><div className="card-label"><span>✦</span><p><small>Исследование AI</small><b>Резюме для принятия решения</b></p><em>Версия 1</em></div><p className="lead">{firstName} — сильный руководитель с подтверждённым опытом системной перестройки функции и управления командой до 23 человек. В интервью приведены измеримые результаты и показан высокий уровень личной ответственности.</p><p>Профиль соответствует ключевым ожиданиям вакансии: операционное управление, антикризисные изменения и автономность подтверждены независимыми фрагментами резюме и интервью. Основной пробел — отсутствие прямого опыта в одном из отраслевых направлений; при этом есть релевантный опыт быстрого погружения в смежные области.</p><div className="ai-conclusion"><i>✓</i><div><b>Рекомендация AI</b><p>Продолжить процесс и на следующем этапе проверить отраслевую глубину и готовность к офисному формату.</p></div></div></article><div className="overview-pair"><article className="panel mini-insight positive"><div><span>↗</span><h3>Сильные стороны</h3></div><ul><li>Управление командой и делегирование</li><li>Измеримые антикризисные результаты</li><li>Самостоятельность в принятии решений</li></ul></article><article className="panel mini-insight warning"><div><span>!</span><h3>Риски и пробелы</h3></div><ul><li>Нет прямого опыта в БФЛ</li><li>Не подтверждён формат 4 дня в офисе</li><li>Нужна проверка роли в автоматизации</li></ul></article></div><EvidenceDetails onNotify={onNotify} /></div><aside className="overview-side"><article className="panel abc-panel"><div className="panel-head"><div><p className="eyebrow">Оценка соответствия</p><h2>ABC-профиль</h2></div></div>{[["A", "Продуктивность", 96], ["A", "Инициатива", 91], ["B", "Самообучаемость", 76], ["A", "Автономность", 94], ["B", "Ценности", 79]].map((item) => <div className="abc-item" key={String(item[1])}><span className={item[0] === "A" ? "a" : "b"}>{item[0]}</span><p><b>{item[1]}</b><i><em style={{ width: `${item[2]}%` }} /></i></p><small>{item[2]}%</small></div>)}</article><article className="panel checklist-panel"><p className="eyebrow">Допуск к КЕ</p><h2>6 из 7 условий</h2>{["Обязательный опыт", "Ключевые компетенции", "Нет стоп-факторов", "Условия работы"].map((item, index) => <div key={item}><i className={index === 3 ? "pending" : "done"}>{index === 3 ? "?" : "✓"}</i><span><b>{item}</b><small>{index === 3 ? "Требует уточнения" : "Подтверждено"}</small></span></div>)}</article><MaterialsPanel candidateName={candidate.name} onNotify={onNotify} /></aside></section>;
}

function EvidenceDetails({ onNotify }: { onNotify: (message: string) => void }) {
  const criteria = ["Продуктивность", "Инициатива", "Самообучаемость", "Автономность", "Корпоративные ценности"];
  return <article className="panel evidence-details"><div className="panel-head"><div><p className="eyebrow">Критерии и факты</p><h2>Детальная оценка</h2></div><span className="confidence-chip">Уверенность 87%</span></div>{criteria.map((item, index) => <div className="criteria-row" key={item}><span className={index === 2 || index === 4 ? "grade-b" : "grade-a"}>{index === 2 || index === 4 ? "B" : "A"}</span><div><h3>{item}</h3><p>{index === 2 ? "Есть два релевантных примера, но скорость освоения новой области не подтверждена." : "Подтверждено несколькими независимыми фактами из резюме и интервью."}</p><small>2 доказательства · резюме и интервью</small></div><button onClick={() => onNotify(`Открыты доказательства: ${item}`)}>Открыть факты →</button></div>)}</article>;
}

function MaterialsPanel({ candidateName, onNotify, processing = false }: { candidateName: string; onNotify: (message: string) => void; processing?: boolean }) {
  const files = [["▧", `Резюме ${candidateName}.pdf`, "PDF · 2,4 МБ", "Обработано"], ["▶", "Интервью 12.08.2026.mp4", "Видео · 1,2 ГБ", processing ? "Обрабатывается" : "Транскрибировано"], ["▤", "Заметки рекрутера.docx", "Документ · 84 КБ", "Обработано"]];
  return <article className="panel sources-panel materials-compact"><div className="panel-head"><div><p className="eyebrow">Google Drive</p><h2>Материалы</h2></div><button onClick={() => onNotify("Синхронизация с Google Drive запущена")}>↻</button></div>{files.map((file) => <div key={file[1]}><span>{file[0]}</span><p><b>{file[1]}</b><small>{file[2]}</small></p><i>{file[3]}</i><button onClick={() => onNotify(`Открыт файл: ${file[1]}`)}>↗</button></div>)}</article>;
}

function TranscriptTab() {
  const [search, setSearch] = useState("");
  const rows = [["26:14", "HR", "Расскажите о самом сложном изменении, которое вы проводили в отделе."], ["26:32", "Анна", "Когда я пришла, около трети задач были просрочены. Я начала с аудита процессов и интервью с командой..."], ["28:08", "Анна", "Через четыре месяца объём просроченных задач сократился на 68%, а средний срок ответа бизнесу — почти вдвое."]];
  const shown = rows.filter((row) => row.join(" ").toLowerCase().includes(search.toLowerCase()));
  return <section className="tab-panel panel transcript"><div className="panel-head"><div><p className="eyebrow">Интервью · 58:16</p><h2>Транскрипция</h2></div><label className="transcript-search">⌕ <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по тексту" /></label></div>{shown.map((row, index) => <article className={index > 0 ? "highlight" : ""} key={row[0]}><time>{row[0]}</time><b>{row[1]}</b><p>{row[2]}</p></article>)}{shown.length === 0 && <div className="empty-state">Совпадений не найдено.</div>}</section>;
}
