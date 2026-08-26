"use client";

import { useEffect, useRef, useState, type FormEvent, type MutableRefObject, type ReactNode } from "react";
import {
  type AbcDirectionField,
  type AbcProfileDirection,
  type AbcProfileValidationError,
  validateAbcProfile,
} from "./abc-profile-validation";
import {
  DARK_THEME_QUERY,
  THEME_STORAGE_KEY,
  applyTheme,
  parseTheme,
  readStoredTheme,
  resolveTheme,
  writeStoredTheme,
  type Theme,
} from "./theme-preference";
import {
  WORKFLOW_LABELS,
  abcGradePercent,
  buildDashboardSnapshot,
  calculateAbcMatchPercent,
  canArchive,
  canReprocess,
  getGreeting,
  isProcessingStatus,
  mergeCandidateLifecycleProjection,
  validateResultPair,
  validateVacancyTitle,
  type CandidateRecord,
  type CandidateTranscript,
  type CandidateEvidenceItem,
  type CandidateId,
  type Recommendation,
  type ResultDocumentType,
  type VacancyCreateState,
  type VacancyRecord,
  type WorkflowStatus,
} from "./product-model";

type View = "dashboard" | "vacancies" | "candidates" | "candidate";
type UiCandidate = CandidateRecord & {
  revision?: number;
  tone: string;
  updated: string;
};
type StoredUiCandidate = CandidateRecord & { revision: number };

function CandidateProgress({ candidate, compact = false, valueOverride }: { candidate: CandidateRecord; compact?: boolean; valueOverride?: number }) {
  const progressValue = valueOverride ?? candidate.progressPercent;
  const hasProgress = Number.isFinite(progressValue);
  const value = hasProgress
    ? Math.min(100, Math.max(0, Math.round(progressValue!)))
    : null;
  const storedMilestone = candidate.progressMilestone?.trim();
  const milestone = candidate.archived
    ? "В архиве"
    : candidate.status === "READY"
    ? (storedMilestone && storedMilestone !== WORKFLOW_LABELS.READY ? storedMilestone : "Результат опубликован")
    : (storedMilestone || WORKFLOW_LABELS[candidate.status]);
  return (
    <span className={`candidate-progress ${compact ? "candidate-progress-compact" : ""}`}>
      <span className="progress-copy">
        {compact ? (value === null ? "Прогресс формируется" : `${value}%`) : <>{milestone}{value === null ? "" : ` · ${value}%`}</>}
      </span>
      <span
        className="progress-track"
        role={value === null ? undefined : "progressbar"}
        aria-label={`Прогресс обработки: ${milestone}`}
        aria-valuenow={value ?? undefined}
        aria-valuemin={value === null ? undefined : 0}
        aria-valuemax={value === null ? undefined : 100}
      >
        <i style={{ width: value === null ? "0" : `${value}%` }} />
      </span>
    </span>
  );
}

function displayedElapsedMinutes(candidate: CandidateRecord, now = Date.now()) {
  const stored = Number.isFinite(candidate.elapsedMinutes) ? Math.max(0, Math.floor(candidate.elapsedMinutes)) : 0;
  if (!isProcessingStatus(candidate.status)) return stored;
  const startedAt = Date.parse(candidate.stageStartedAt);
  if (!Number.isFinite(startedAt)) return stored;
  return Math.max(stored, Math.max(0, Math.floor((now - startedAt) / 60_000)));
}
type UiVacancy = VacancyRecord & {
  short: string;
  avatar: string;
  color: string;
};
type VacancyPromptPayload = {
  generation: { text: string; artifactId: "vacancy-profile/v1"; hash: string };
  analysis: { text: string; artifactId: "candidate-assessment/v1"; hash: string };
  analysisDefault: { text: string; artifactId: "candidate-assessment/v1"; hash: string };
  fieldGenerationPrompts: Record<GenerationPromptKey, PromptSnapshot>;
  fieldGenerationDefaults: Record<GenerationPromptKey, PromptSnapshot>;
  generationPromptsRevision: number;
};
type PromptSnapshot = { text: string; artifactId: "vacancy-profile/v1"; hash: string };
type GenerationPromptKey = "Образ результата" | "Компетенции" | "Стоп-факторы" | "Допуск к КЕ" | "ABC-критерии";
const FIELD_GENERATION_KEYS: GenerationPromptKey[] = ["Образ результата", "Компетенции", "Стоп-факторы", "Допуск к КЕ", "ABC-критерии"];

function playVacancyReadySound() {
  try {
    const context = new window.AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(660, context.currentTime);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.2);
    oscillator.addEventListener("ended", () => void context.close().catch(() => {}), { once: true });
  } catch { /* Sound is an optional enhancement. */ }
}
type DashboardSnapshot = ReturnType<typeof buildDashboardSnapshot>;
type DriveConnection = {
  state: "CONNECTED" | "REAUTH_REQUIRED" | "DISCONNECTED" | "MISCONFIGURED";
  connected: boolean;
  ownerEmail?: string;
  rootFolderName?: string;
  rootFolderUrl?: string;
  nextAction?: string;
  error?: string;
};
type Preview = {
  candidateId: CandidateId;
  type: ResultDocumentType;
  version: number;
  title: string;
} | null;
type DashboardStatusFilter =
  | "MATERIALS_INCOMPLETE"
  | "TRANSCRIBING"
  | "ANALYZING"
  | "VALIDATING"
  | "WAITING_FOR_HUMAN"
  | "READY"
  | "FAILED";
type QueueFilter =
  | { kind: "status"; status: DashboardStatusFilter }
  | { kind: "archive" }
  | {
      kind: "recommendation";
      recommendation: Recommendation;
      period: 7 | 30 | 90;
      candidateIds: CandidateId[];
    }
  | null;
const DRIVE_POLL_INTERVAL_MS = 15 * 1000;
const WORKSPACE_POLL_INTERVAL_MS = 3 * 1000;
const DASHBOARD_POLL_INTERVAL_MS = 3 * 1000;

const STANDARD_ABC_DIRECTIONS: readonly AbcProfileDirection[] = [
  [
    "productivity",
    "Продуктивность",
    "Превосходит ожидаемый результат",
    "Стабильно достигает результата",
    "Не достигает результата",
  ],
  [
    "initiative",
    "Инициатива",
    "Действует проактивно",
    "Предлагает улучшения после постановки",
    "Ждёт подробных указаний",
  ],
  [
    "self-learning",
    "Самообучаемость",
    "Самостоятельно осваивает новый контекст",
    "Осваивает с поддержкой",
    "Повторяет ошибки",
  ],
  [
    "corporate-values",
    "Корпоративные ценности",
    "Подтверждает ценности примерами",
    "В целом соответствует",
    "Есть подтверждённые противоречия",
  ],
  [
    "autonomy",
    "Автономность",
    "Приносит варианты и рекомендацию",
    "Самостоятелен в типовых задачах",
    "Требует постоянного контроля",
  ],
].map(([id, name, gradeA, gradeB, gradeC]) => ({
  id,
  name,
  gradeA,
  gradeB,
  gradeC,
  origin: "standard",
}));

const createStandardAbcDirections = () =>
  STANDARD_ABC_DIRECTIONS.map((direction) => ({ ...direction, gradeA: "", gradeB: "", gradeC: "" })) as AbcProfileDirection[];

const VACANCY_COLORS = ["#ff98d8", "#ffc56b", "#58dfc4", "#87a9ff", "#a78bfa"];
const CANDIDATE_TONES = ["pink", "blue", "orange", "mint", "violet"];
const LEGACY_PROFILE_LABELS: Readonly<Record<string, string>> = {
  цельДолжности: "Цель должности",
  измеримыеРезультаты: "Измеримые результаты",
  результат: "Результат",
  метрики: "Метрики",
  личныйВклад: "Личный вклад",
  ожидаемыеИзменения: "Ожидаемые изменения",
  масштабИРелевантность: "Масштаб и релевантность",
  ключевыеКомпетенции: "Ключевые компетенции",
  критичныеПрофессиональныеНавыки: "Критические профессиональные навыки",
  название: "Название",
  навык: "Навык",
  наблюдаемыеПризнаки: "Наблюдаемые признаки",
  условие: "Условие",
  какПроверить: "Как проверить",
  ожидаемыеДоказательства: "Ожидаемые доказательства",
  чекЛист: "Чек-лист",
  критерий: "Критерий",
  статус: "Статус",
  требование: "Требование",
  итогДопуска: "Итог допуска",
  чтоТребуетсяДополнить: "Что требуется дополнить",
};
const LEGACY_TOP_LEVEL_LABELS = new Set([
  "Цель должности",
  "Измеримые результаты",
  "Личный вклад",
  "Ожидаемые изменения",
  "Масштаб и релевантность",
  "Ключевые компетенции",
  "Критические профессиональные навыки",
  "Чек-лист",
  "Итог допуска",
  "Что требуется дополнить",
]);
function readableLegacyProfileText(value: string): string {
  const output: string[] = [];
  for (const rawLine of value.split(/\r?\n/)) {
    const match = rawLine.trimEnd().match(/^(\s*)(•\s*)?([^:]+):(.*)$/);
    let line = rawLine.trimEnd();
    let label = "";
    let topLevel = false;
    if (match) {
      const [, indent, bullet = "", rawLabel, rest] = match;
      label =
        LEGACY_PROFILE_LABELS[rawLabel.trim()] ??
        rawLabel.trim().replace(/([а-яёa-z\d])([А-ЯЁA-Z])/g, "$1 $2");
      line = `${indent}${bullet}${label}:${rest}`.replace(/[ \t]+$/g, "");
      topLevel =
        indent.length === 0 && !bullet && LEGACY_TOP_LEVEL_LABELS.has(label);
    }
    if (topLevel && output.some((item) => item.trim()))
      while (output.at(-1) === "") output.pop();
    if (topLevel && output.some((item) => item.trim())) output.push("");
    output.push(line);
  }
  return output
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
const hydrateVacancy = (vacancy: VacancyRecord, index: number): UiVacancy => ({
  ...vacancy,
  profile: Object.fromEntries(
    Object.entries(vacancy.profile).map(([key, value]) => [
      key,
      readableLegacyProfileText(value),
    ]),
  ),
  active: vacancy.active !== false,
  archived: vacancy.archived === true,
  short: vacancy.title,
  avatar: vacancy.title.slice(0, 2).toUpperCase(),
  color: VACANCY_COLORS[index % VACANCY_COLORS.length],
});
const hydrateCandidate = (
  candidate: StoredUiCandidate,
  index: number,
): UiCandidate => ({
  ...candidate,
  tone: CANDIDATE_TONES[index % CANDIDATE_TONES.length],
  updated: candidate.archived ? "В архиве" : WORKFLOW_LABELS[candidate.status],
});

const nav: { id: View; label: string; icon: string }[] = [
  { id: "dashboard", label: "Дашборд", icon: "⌘" },
  { id: "vacancies", label: "Вакансии", icon: "▤" },
  { id: "candidates", label: "Кандидаты", icon: "♙" },
];
const statusClass = (status: WorkflowStatus) =>
  `status status-${status.toLowerCase().replaceAll("_", "-")}`;
function StatusPill({
  status,
  archived,
}: {
  status: WorkflowStatus;
  archived?: boolean;
}) {
  if (archived) {
    return (
      <span className="status status-archived">
        <i />
        В архиве
      </span>
    );
  }
  return (
    <span className={statusClass(status)}>
      <i />
      {WORKFLOW_LABELS[status]}
    </span>
  );
}

type ConfirmationDialogProps = {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

function ConfirmationDialog({ title, description, confirmLabel, danger = false, busy = false, onCancel, onConfirm }: ConfirmationDialogProps) {
  return (
    <div className="modal-backdrop confirmation-backdrop" role="presentation">
      <section className="confirmation-modal panel" role="dialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-description">
        <span className={`confirmation-icon ${danger ? "danger" : "archive"}`} aria-hidden="true">{danger ? "!" : "↘"}</span>
        <div className="confirmation-copy">
          <h2 id="confirmation-title">{title}</h2>
          <div id="confirmation-description">{description}</div>
        </div>
        <div className="confirmation-actions">
          <button className="secondary-button" disabled={busy} onClick={onCancel}>Отмена</button>
          <button className={danger ? "danger-button" : "primary-button"} disabled={busy} onClick={onConfirm}>
            {busy ? "Выполняем…" : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

type AuthState = {
  phase: "checking" | "anonymous" | "password-change" | "authenticated";
  user?: { displayName: string; email: string };
  sessionExpired?: boolean;
};
const csrfToken = () =>
  typeof document === "undefined"
    ? ""
    : (document.cookie
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("hh_csrf="))
        ?.slice("hh_csrf=".length) ?? "");

export default function Home() {
  const [auth, setAuth] = useState<AuthState>({ phase: "checking" });
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/auth/session", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          authenticated?: boolean;
          scope?: string;
          user?: { displayName: string; email: string };
        };
        if (!response.ok || !payload.authenticated)
          setAuth({
            phase: "anonymous",
            sessionExpired:
              new URLSearchParams(location.search).get("reason") === "expired",
          });
        else
          setAuth({
            phase:
              payload.scope === "PASSWORD_CHANGE_ONLY"
                ? "password-change"
                : "authenticated",
            user: payload.user,
          });
      })
      .catch(() => {
        if (!controller.signal.aborted) setAuth({ phase: "anonymous" });
      });
    return () => controller.abort();
  }, []);
  if (auth.phase === "checking")
    return (
      <main className="auth-loading" role="status">
        Проверяем защищённую сессию…
      </main>
    );
  if (auth.phase === "anonymous")
    return (
      <LoginShell
        sessionExpired={auth.sessionExpired}
        onAuthenticated={(user, mustChange) =>
          setAuth({
            phase: mustChange ? "password-change" : "authenticated",
            user,
          })
        }
      />
    );
  if (auth.phase === "password-change")
    return (
      <PasswordChangeShell
        user={auth.user}
        onChanged={() => setAuth({ phase: "authenticated", user: auth.user })}
        onLogout={() => setAuth({ phase: "anonymous" })}
      />
    );
  return (
    <ProductApp
      user={auth.user}
      onLogout={() => setAuth({ phase: "anonymous" })}
    />
  );
}

function LoginShell({
  sessionExpired,
  onAuthenticated,
}: {
  sessionExpired?: boolean;
  onAuthenticated: (
    user: { displayName: string; email: string },
    mustChange: boolean,
  ) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, remember, returnPath: "/" }),
      });
      const payload = (await response.json()) as {
        error?: string;
        scope?: string;
        user?: { displayName: string; email: string };
      };
      if (!response.ok || !payload.user)
        throw new Error(payload.error || "Не удалось войти. Проверьте данные");
      setPassword("");
      onAuthenticated(payload.user, payload.scope === "PASSWORD_CHANGE_ONLY");
    } catch (reason) {
      setPassword("");
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось войти. Проверьте данные",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth-shell">
      <section className="auth-showcase" aria-hidden="true">
        <div className="auth-brand">
          <span className="brand-mark" />
          <span>
            <b>Правильный выбор</b>
            <small>AI talent intelligence</small>
          </span>
        </div>
        <div className="auth-showcase-copy">
          <span>Удобный контроль найма</span>
          <h1>
            Видно главное.
            <br />
            Решение — за вами.
          </h1>
          <p>
            Кандидаты, этапы обработки и доказательные AI-результаты в одном
            рабочем пространстве.
          </p>
        </div>
        <div className="auth-demo-stack">
          <article className="auth-demo-candidate">
            <header>
              <span className="avatar blue">#</span>
              <span>
                <small>Кандидат #1482</small>
                <b>Руководитель направления</b>
              </span>
              <em>68%</em>
            </header>
            <div className="auth-demo-stages">
              <i className="done">✓</i>
              <span />
              <i className="done">✓</i>
              <span />
              <i className="active">3</i>
              <span />
              <i>4</i>
            </div>
            <footer>
              <span>Материалы</span>
              <span>Транскрибация</span>
              <span>AI-анализ</span>
              <span>Готово</span>
            </footer>
          </article>
          <article className="auth-demo-result">
            <small>AI-результат</small>
            <b>Высокое соответствие профилю</b>
            <div>
              <span>
                Опыт <strong>A</strong>
              </span>
              <span>
                Компетенции <strong>B</strong>
              </span>
              <span>
                Риски <strong>2</strong>
              </span>
            </div>
          </article>
        </div>
        <small className="auth-example-label">
          Пример интерфейса · синтетические данные
        </small>
      </section>
      <section className="auth-entry">
        <button
          type="button"
          className="auth-theme"
          onClick={() => {
            const next =
              document.documentElement.dataset.theme === "dark"
                ? "light"
                : "dark";
            applyTheme(next);
            writeStoredTheme(next);
          }}
          aria-label="Переключить тему"
        >
          ☀
        </button>
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-mobile-brand">
            <span className="brand-mark" />
            <b>Правильный выбор</b>
          </div>
          <p className="eyebrow">Защищённое пространство HR</p>
          <h2>Добро пожаловать</h2>
          <p>Войдите с корпоративной почтой.</p>
          {sessionExpired && (
            <div className="auth-notice" role="status">
              Сессия завершена. Войдите снова.
            </div>
          )}
          <label className="auth-field">
            <span>Корпоративная почта</span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@company.ru"
            />
          </label>
          <label className="auth-field">
            <span>Пароль</span>
            <span className="auth-password">
              <input
                type={visible ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                onClick={() => setVisible((value) => !value)}
                aria-label={visible ? "Скрыть пароль" : "Показать пароль"}
              >
                {visible ? "Скрыть" : "Показать"}
              </button>
            </span>
          </label>
          <div className="auth-options">
            <label>
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />{" "}
              Запомнить меня
            </label>
            <button
              type="button"
              onClick={() =>
                setError(
                  "Для восстановления пароля обратитесь к администратору системы.",
                )
              }
            >
              Забыли пароль?
            </button>
          </div>
          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}
          <button className="auth-submit" disabled={busy}>
            {busy ? "Входим…" : "Войти"}
          </button>
          <small className="auth-access-note">
            Доступ только для сотрудников компании
          </small>
        </form>
      </section>
    </main>
  );
}

function PasswordChangeShell({
  user,
  onChanged,
  onLogout,
}: {
  user?: { displayName: string; email: string };
  onChanged: () => void;
  onLogout: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const logout = async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "x-csrf-token": csrfToken() },
    });
    onLogout();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const response = await fetch("/api/auth/password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken(),
      },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const payload = (await response.json()) as { error?: string };
    setBusy(false);
    if (!response.ok)
      return setError(payload.error || "Не удалось изменить пароль");
    setCurrentPassword("");
    setNewPassword("");
    onChanged();
  };
  return (
    <main className="auth-shell auth-change-shell">
      <section className="auth-entry">
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-mobile-brand">
            <span className="brand-mark" />
            <b>Правильный выбор</b>
          </div>
          <p className="eyebrow">Первый вход</p>
          <h2>Создайте новый пароль</h2>
          <p>
            {user?.displayName || user?.email}. Временный пароль необходимо
            заменить перед началом работы.
          </p>
          <label className="auth-field">
            <span>Временный пароль</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <label className="auth-field">
            <span>Новый пароль</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <small>Не менее 12 символов</small>
          </label>
          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}
          <button className="auth-submit" disabled={busy}>
            {busy ? "Сохраняем…" : "Изменить пароль"}
          </button>
          <button
            className="auth-logout-link"
            type="button"
            onClick={() => void logout()}
          >
            Выйти
          </button>
        </form>
      </section>
    </main>
  );
}

function ProductApp({
  user,
  onLogout,
}: {
  user?: { displayName: string; email: string };
  onLogout: () => void;
}) {
  const [view, setView] = useState<View>("dashboard");
  const [previousView, setPreviousView] = useState<View>("dashboard");
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateId>(1);
  const [candidates, setCandidates] = useState<UiCandidate[]>([]);
  const [vacancyState, setVacancyState] = useState<VacancyCreateState>({
    vacancies: [],
    operationBindings: {},
  });
  const [toast, setToast] = useState("");
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState<Theme>("light");
  const [driveConnection, setDriveConnection] =
    useState<DriveConnection | null>(null);
  const [scanCountdown, setScanCountdown] = useState(15);
  const [preview, setPreview] = useState<Preview>(null);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>(null);
  const [candidateConfirmation, setCandidateConfirmation] = useState<"archive" | "delete" | "reprocess" | null>(null);
  const [driveDisconnectConfirmation, setDriveDisconnectConfirmation] = useState(false);
  const [pendingViewAfterGeneration, setPendingViewAfterGeneration] = useState<View | null>(null);
  const vacancySettingsNavigation = useRef<VacancySettingsNavigation | null>(null);

  useEffect(() => {
    const media =
      typeof window.matchMedia === "function"
        ? window.matchMedia(DARK_THEME_QUERY)
        : null;
    const synchronizeTheme = () => {
      const nextTheme = resolveTheme(
        readStoredTheme(),
        media?.matches ?? false,
      );
      applyTheme(nextTheme);
      setTheme(nextTheme);
    };
    const handleSystemChange = () => {
      if (readStoredTheme() === null) synchronizeTheme();
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) synchronizeTheme();
    };
    synchronizeTheme();
    media?.addEventListener("change", handleSystemChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      media?.removeEventListener("change", handleSystemChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);
  useEffect(() => {
    let active = true;
    let inFlight = false;
    let controller: AbortController | null = null;
    const synchronizeWorkspace = async () => {
      if (inFlight) return;
      inFlight = true;
      controller = new AbortController();
      try {
        const response = await fetch("/api/workspace", {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          candidates?: StoredUiCandidate[];
          vacancies?: VacancyRecord[];
        };
        if (!active || !response.ok || !payload.candidates || !payload.vacancies) return;
        const incoming = payload.candidates.map(hydrateCandidate);
        setCandidates((current) => incoming.map((candidate) => {
          const previous = current.find((item) => item.id === candidate.id);
          if (previous?.revision !== undefined && candidate.revision !== undefined && previous.revision > candidate.revision) return previous;
          return { ...candidate, tone: previous?.tone ?? candidate.tone };
        }));
        setVacancyState({
          vacancies: payload.vacancies.map(hydrateVacancy),
          operationBindings: {},
        });
      } catch {
        // A later poll reconciles a temporary workspace read failure.
      } finally {
        inFlight = false;
      }
    };
    void synchronizeWorkspace();
    const poll = window.setInterval(() => void synchronizeWorkspace(), WORKSPACE_POLL_INTERVAL_MS);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(poll);
    };
  }, []);
  useEffect(() => {
    let active = true;
    const checkDrive = async () => {
      setScanCountdown(15);
      try {
        const response = await fetch(
          "/api/integrations/google-drive/oauth/status",
          { cache: "no-store" },
        );
        const payload = (await response.json()) as DriveConnection;
        if (active) setDriveConnection(payload);
      } catch {
        if (active)
          setDriveConnection({
            state: "MISCONFIGURED",
            connected: false,
            nextAction: "Проверить конфигурацию",
          });
      }
    };
    void checkDrive();
    const poll = window.setInterval(
      () => void checkDrive(),
      DRIVE_POLL_INTERVAL_MS,
    );
    const clock = window.setInterval(
      () => setScanCountdown((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => {
      active = false;
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, []);
  const connectDrive = async () => {
    try {
      const response = await fetch(
        "/api/integrations/google-drive/oauth/connect",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrfToken(),
          },
          body: JSON.stringify({ returnPath: "/" }),
        },
      );
      const payload = (await response.json()) as {
        authorizationUrl?: string;
        error?: string;
      };
      if (!response.ok || !payload.authorizationUrl)
        throw new Error(payload.error ?? "Не удалось начать подключение");
      window.location.assign(payload.authorizationUrl);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Google Drive недоступен",
      );
    }
  };
  const disconnectDrive = async () => {
    try {
      const response = await fetch(
        "/api/integrations/google-drive/oauth/disconnect",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrfToken(),
          },
          body: JSON.stringify({ confirm: true }),
        },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(payload.error ?? "Не удалось отключить Google Drive");
      setDriveConnection({
        state: "DISCONNECTED",
        connected: false,
        nextAction: "Подключить Google Drive",
      });
      notify("Google Drive отключён; файлы сохранены");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Google Drive недоступен",
      );
    }
  };
  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };
  const toggleTheme = () => {
    const currentTheme =
      parseTheme(document.documentElement.dataset.theme) ?? theme;
    const nextTheme: Theme = currentTheme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    writeStoredTheme(nextTheme);
    setTheme(nextTheme);
  };
  const navigate = (nextView: View) => {
    if (nextView === view) return;
    if (view === "vacancies" && vacancySettingsNavigation.current?.isGenerating()) {
      setPendingViewAfterGeneration(nextView);
      return;
    }
    if (nextView === "candidates") setQueueFilter(null);
    setView(nextView);
  };
  const cancelGenerationAndNavigate = () => {
    const nextView = pendingViewAfterGeneration;
    vacancySettingsNavigation.current?.cancelGeneration();
    setPendingViewAfterGeneration(null);
    if (!nextView) return;
    if (nextView === "candidates") setQueueFilter(null);
    setView(nextView);
  };
  const openCandidate = (id: CandidateId) => {
    setPreviousView(view === "candidate" ? "candidates" : view);
    setSelectedCandidate(id);
    setView("candidate");
  };
  const openFilteredQueue = (filter: Exclude<QueueFilter, null>) => {
    setQueueFilter(filter);
    setView("candidates");
  };
  const updateCandidate = (
    id: CandidateId,
    action: (candidate: UiCandidate) => UiCandidate,
  ) =>
    setCandidates((items) =>
      items.map((item) => (item.id === id ? action(item) : item)),
    );
  const runLifecycle = async (
    action: "archive" | "restore" | "delete" | "reprocess",
  ) => {
    const current = candidates.find(
      (candidate) => candidate.id === selectedCandidate,
    );
    if (!current) return;
    try {
      const response = await fetch("/api/candidates/lifecycle", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken(),
        },
        body: JSON.stringify({
          candidateId: current.id,
          action,
          expectedRevision: current.revision ?? 1,
        }),
      });
      const payload = (await response.json()) as {
        candidate?: StoredUiCandidate | null;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "Команда отклонена");
      if (action === "delete") {
        setCandidates((items) =>
          items.filter((item) => item.id !== current.id),
        );
        setView("candidates");
      } else if (payload.candidate) {
        updateCandidate(current.id, (candidate) => {
          const next = mergeCandidateLifecycleProjection(
            candidate,
            payload.candidate!,
            action,
          );
          return {
            ...next,
            tone: candidate.tone,
            updated: next.archived ? "В архиве" : WORKFLOW_LABELS[next.status],
          };
        });
      }
      notify(
        action === "reprocess"
          ? "Повторная обработка поставлена на проверку стабильности"
          : "Состояние кандидата обновлено",
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Команда временно недоступна",
      );
    }
  };
  const matching = candidates.filter((candidate) =>
    `${candidate.name} ${candidate.vacancy}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const vacancies = vacancyState.vacancies as UiVacancy[];

  const logout = async () => {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "x-csrf-token": csrfToken() },
    });
    if (response.ok) onLogout();
    else notify("Не удалось завершить сессию");
  };
  return (
    <main className="app">
      <header className="topbar">
        <button className="brand" onClick={() => navigate("dashboard")}>
          <span className="brand-mark" aria-hidden="true" />
          <span>
            <b>Правильный выбор</b>
            <small>AI talent intelligence</small>
          </span>
        </button>
        <nav className="main-nav" aria-label="Основная навигация">
          {nav.map((item) => (
            <button
              key={item.id}
              className={
                (view === "candidate" ? "candidates" : view) === item.id
                  ? "active"
                  : ""
              }
              onClick={() => navigate(item.id)}
            >
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="top-actions">
          <label className="global-search">
            <span>⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск"
            />
          </label>
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label="Тёмная тема"
            aria-pressed={theme === "dark"}
            title={
              theme === "dark"
                ? "Включить светлую тему"
                : "Включить тёмную тему"
            }
          >
            <span className="theme-icon-dark" aria-hidden="true">
              ☾
            </span>
            <span className="theme-icon-light" aria-hidden="true">
              ☀
            </span>
          </button>
          <button
            type="button"
            className="profile profile-button"
            onClick={() => void logout()}
            title="Выйти"
          >
            <span className="avatar avatar-owner">АС</span>
            <span>
              <b>{user?.displayName || "Алсу Салямова"}</b>
              <small>HR-директор · выйти</small>
            </span>
          </button>
        </div>
      </header>
      {view === "dashboard" && (
        <Dashboard
          driveConnection={driveConnection}
          countdown={scanCountdown}
          onConnectDrive={() => void connectDrive()}
          onDisconnectDrive={() => setDriveDisconnectConfirmation(true)}
          onOpen={openCandidate}
          onNavigate={navigate}
          onQueueFilter={openFilteredQueue}
        />
      )}
      {view === "vacancies" && (
        <Vacancies
          candidates={candidates}
          vacancyState={vacancyState}
          onState={setVacancyState}
          onOpen={openCandidate}
          onNotify={notify}
          settingsNavigationRef={vacancySettingsNavigation}
          onCandidatesDeleted={(vacancyId) =>
            setCandidates((items) => items.filter((candidate) => candidate.vacancyId !== vacancyId))
          }
        />
      )}
      {view === "candidates" && (
        <Candidates
          items={matching}
          vacancies={vacancies}
          onOpen={openCandidate}
          dashboardFilter={queueFilter}
          onClearDashboardFilter={() => setQueueFilter(null)}
        />
      )}
      {view === "candidate" && candidates.length > 0 && (
        <CandidateDetail
          candidate={
            candidates.find((item) => item.id === selectedCandidate) ??
            candidates[0]
          }
          onBack={() => setView(previousView)}
          onPreview={setPreview}
          onArchive={() => {
            const item = candidates.find(
              (candidate) => candidate.id === selectedCandidate,
            )!;
            if (canArchive(item)) setCandidateConfirmation("archive");
          }}
          onRestore={() => void runLifecycle("restore")}
          onDelete={() => setCandidateConfirmation("delete")}
          onReprocess={() => setCandidateConfirmation("reprocess")}
        />
      )}
      {preview && (
        <PdfPreview preview={preview} onClose={() => setPreview(null)} />
      )}
      {candidateConfirmation && (
        <ConfirmationDialog
          title={candidateConfirmation === "archive"
            ? "Переместить кандидата в архив?"
            : candidateConfirmation === "delete"
              ? "Удалить кандидата?"
              : "Запустить повторную обработку кандидата?"}
          description={candidateConfirmation === "archive"
            ? <p>Карточка и результаты сохранятся и будут доступны в разделе «Архив».</p>
            : candidateConfirmation === "delete"
              ? <p>Данные кандидата будут удалены из приложения без возможности восстановления. Файлы в Google Drive останутся без изменений.</p>
              : <p>Предыдущие результаты станут недоступны, а данные кандидата будут обновлены.</p>}
          confirmLabel={candidateConfirmation === "archive" ? "В архив" : candidateConfirmation === "delete" ? "Удалить" : "Запустить"}
          danger={candidateConfirmation === "delete"}
          onCancel={() => setCandidateConfirmation(null)}
          onConfirm={() => {
            const action = candidateConfirmation;
            setCandidateConfirmation(null);
            void runLifecycle(action);
          }}
        />
      )}
      {driveDisconnectConfirmation && (
        <ConfirmationDialog
          title="Отключить Google Drive?"
          description={<p>Файлы и данные кандидатов останутся без изменений.</p>}
          confirmLabel="Отключить"
          danger
          onCancel={() => setDriveDisconnectConfirmation(false)}
          onConfirm={() => {
            setDriveDisconnectConfirmation(false);
            void disconnectDrive();
          }}
        />
      )}
      {pendingViewAfterGeneration && (
        <ConfirmationDialog
          title="Прервать генерацию и перейти?"
          description={<p>Генерация будет завершена, поле не будет заполнено.</p>}
          confirmLabel="Прервать и перейти"
          danger
          onCancel={() => setPendingViewAfterGeneration(null)}
          onConfirm={cancelGenerationAndNavigate}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          ✓ {toast}
        </div>
      )}
    </main>
  );
}

function Dashboard({
  driveConnection,
  countdown,
  onConnectDrive,
  onDisconnectDrive,
  onOpen,
  onNavigate,
  onQueueFilter,
}: {
  driveConnection: DriveConnection | null;
  countdown: number;
  onConnectDrive: () => void;
  onDisconnectDrive: () => void;
  onOpen: (id: CandidateId) => void;
  onNavigate: (view: View) => void;
  onQueueFilter: (filter: Exclude<QueueFilter, null>) => void;
}) {
  const [period, setPeriod] = useState<7 | 30 | 90>(7);
  const [responseState, setResponseState] = useState<{
    period: 7 | 30 | 90;
    snapshot: DashboardSnapshot | null;
    error: string;
  }>({ period: 7, snapshot: null, error: "" });
  const snapshot =
    responseState.period === period ? responseState.snapshot : null;
  const loadError = responseState.period === period ? responseState.error : "";
  useEffect(() => {
    let active = true;
    let inFlight = false;
    let controller: AbortController | null = null;
    const synchronizeDashboard = async () => {
      if (inFlight) return;
      inFlight = true;
      controller = new AbortController();
      try {
        const response = await fetch(`/api/dashboard?period=${period}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          snapshot?: DashboardSnapshot;
          error?: string;
        };
        if (!response.ok || !payload.snapshot)
          throw new Error(payload.error ?? "Операционные данные недоступны");
        if (active) setResponseState({ period, snapshot: payload.snapshot, error: "" });
      } catch (error) {
        if (active && !controller.signal.aborted)
          setResponseState((current) => ({
            period,
            snapshot: current.period === period ? current.snapshot : null,
            error:
              error instanceof Error
                ? error.message
                : "Операционные данные недоступны",
          }));
      } finally {
        inFlight = false;
      }
    };
    void synchronizeDashboard();
    const poll = window.setInterval(() => void synchronizeDashboard(), DASHBOARD_POLL_INTERVAL_MS);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(poll);
    };
  }, [period]);
  const cards: [DashboardStatusFilter, string, number | null, string][] = [
    [
      "MATERIALS_INCOMPLETE",
      "Недостаточно материалов",
      snapshot?.counts.MATERIALS_INCOMPLETE ?? null,
      "status-insufficient",
    ],
    [
      "TRANSCRIBING",
      "Транскрибация",
      snapshot?.counts.TRANSCRIBING ?? null,
      "status-transcribing",
    ],
    [
      "ANALYZING",
      "AI-анализ",
      snapshot?.counts.ANALYZING ?? null,
      "status-analyzing",
    ],
    [
      "VALIDATING",
      "Проверка результатов",
      snapshot?.counts.VALIDATING ?? null,
      "status-validating",
    ],
    ["READY", "Готово", snapshot?.counts.READY ?? null, "status-ready"],
    ["FAILED", "Ошибка", snapshot?.counts.FAILED ?? null, "status-failed"],
  ];
  const flowMax = Math.max(
    1,
    ...(snapshot?.flow.map((item) => item.count) ?? [1]),
  );
  const flowColors = [
    "#168cff",
    "#55dec0",
    "#89a8ff",
    "#ffc87c",
    "#ff8f70",
    "#7dd3fc",
  ];
  const recommendationColors: Record<Recommendation, string> = {
    Рекомендовать: "#55dec0",
    "Рекомендовать с оговорками": "#ffc87c",
    "Недостаточно данных": "#89a8ff",
    "Не рекомендовать": "#ff8f70",
  };
  const recommendationEntries = snapshot
    ? (Object.entries(snapshot.recommendations) as [Recommendation, number][])
    : [];
  const recommendationTotal = recommendationEntries.reduce(
    (sum, [, count]) => sum + count,
    0,
  );
  let recommendationCursor = 0;
  const recommendationGradient =
    recommendationTotal > 0
      ? `conic-gradient(${recommendationEntries
          .map(([label, count]) => {
            const start = recommendationCursor;
            recommendationCursor += (count / recommendationTotal) * 100;
            return `${recommendationColors[label]} ${start}% ${recommendationCursor}%`;
          })
          .join(", ")})`
      : "conic-gradient(#e8edf2 0 100%)";
  return (
    <div className="page dashboard-page">
      <section className="welcome-row">
        <div>
          <p className="breadcrumb">Рабочее пространство / Дашборд</p>
          <h1>{getGreeting()}, Алсу!</h1>
          <p>
            Текущее состояние обработки, вакансий и опубликованных результатов.
          </p>
        </div>
        <div
          className={`drive-monitor drive-${driveConnection?.connected ? "ok" : driveConnection ? "down" : "checking"}`}
        >
          <span className="live-dot" />
          Google Drive:{" "}
          {driveConnection?.connected
            ? "Подключён"
            : driveConnection
              ? "Нет подключения"
              : "Проверяем подключение"}
          {driveConnection?.ownerEmail && (
            <small>
              {driveConnection.ownerEmail} · {driveConnection.rootFolderName}
            </small>
          )}
          {!driveConnection?.ownerEmail && (
            <small>Следующая проверка через {countdown} сек</small>
          )}
          <span className="drive-actions">
            {driveConnection?.rootFolderUrl && (
              <a
                href={driveConnection.rootFolderUrl}
                target="_blank"
                rel="noreferrer"
              >
                Открыть папку
              </a>
            )}
            {driveConnection?.connected ? (
              <button type="button" onClick={onDisconnectDrive}>
                Отключить
              </button>
            ) : (
              <button type="button" onClick={onConnectDrive}>
                {driveConnection?.state === "REAUTH_REQUIRED"
                  ? "Переподключить"
                  : "Подключить"}
              </button>
            )}
          </span>
        </div>
      </section>
      {loadError && (
        <div className="dashboard-data-error" role="alert">
          {loadError}. Статические данные не подставляются.
        </div>
      )}
      <section className="panel processing-panel">
        <div className="panel-head">
          <h2>Контроль очереди</h2>
          <button onClick={() => onNavigate("candidates")}>
            Вся очередь →
          </button>
        </div>
        {snapshot && snapshot.waitingForHuman > 0 && (
          <p role="status">Требуют действия HR: {snapshot.waitingForHuman}</p>
        )}
        <div className="processing-grid">
          {snapshot?.queue.map((candidate) => (
            <button
              className="processing-card"
              key={candidate.id}
              onClick={() => onOpen(candidate.id)}
            >
              <span className="avatar">{candidate.initials}</span>
              <span className="processing-copy">
                <b>{candidate.name}</b>
                <small>{candidate.vacancy}</small>
                <em>{WORKFLOW_LABELS[candidate.status]}</em>
              </span>
              <span className="processing-time">
                <b>
                  {candidate.etaMinutes === null
                    ? "Недостаточно данных для прогноза"
                    : `≈ ${candidate.etaMinutes} мин`}
                </b>
                <small>прошло {displayedElapsedMinutes(candidate)} мин</small>
              </span>
              <CandidateProgress candidate={candidate} />
            </button>
          )) ?? <p>Загружаем актуальную очередь…</p>}
        </div>
      </section>
      <section className="metric-grid">
        {cards.map(([status, label, count, tone]) => (
          <button
            className={`metric-card ${tone}`}
            key={status}
            onClick={() => onQueueFilter({ kind: "status", status })}
          >
            <p>{label}</p>
            <strong>{count ?? "—"}</strong>
            <small>Текущий workflow status</small>
          </button>
        ))}
        <button
          className="metric-card archive"
          onClick={() => onQueueFilter({ kind: "archive" })}
        >
          <p>Архив</p>
          <strong>{snapshot?.archivedCandidates ?? "—"}</strong>
          <small>Архивированные кандидаты</small>
        </button>
      </section>
      <section className="dashboard-grid">
        <article className="panel flow-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Актуальные результаты</p>
              <h2>Поток кандидатов</h2>
            </div>
            <select
              value={period}
              onChange={(event) =>
                setPeriod(Number(event.target.value) as 7 | 30 | 90)
              }
              aria-label="Период графиков"
            >
              <option value="7">7 дней</option>
              <option value="30">30 дней</option>
              <option value="90">90 дней</option>
            </select>
          </div>
          <div
            className="bar-chart vacancy-flow-chart"
            aria-label={`Поток кандидатов за ${period} дней`}
          >
            {snapshot?.flow.map((item, index) => (
              <div className="bar-slot" key={item.vacancyId}>
                <div className="bar-wrap">
                  <strong className="bar-total">{item.count}</strong>
                  <i
                    className="flow-bar"
                    style={{
                      height: `${Math.max(8, (item.count / flowMax) * 118)}px`,
                      background: `linear-gradient(180deg, ${flowColors[index % flowColors.length]}, color-mix(in srgb, ${flowColors[index % flowColors.length]} 72%, #ffffff))`,
                    }}
                  />
                </div>
                <small title={item.title}>{item.title}</small>
              </div>
            ))}
          </div>
          <div className="legend vacancy-legend">
            {snapshot?.flow.map((item, index) => (
              <span key={item.vacancyId}>
                <i
                  style={{ background: flowColors[index % flowColors.length] }}
                />
                {item.title}
              </span>
            ))}
          </div>
        </article>
        <article className="panel result-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Период: {period} дней</p>
              <h2>Результаты анализа</h2>
            </div>
          </div>
          <div className="donut-wrap">
            <div
              className="donut results-donut"
              style={{ background: recommendationGradient }}
            >
              <div>
                <small>Готово</small>
                <strong>{recommendationTotal}</strong>
              </div>
            </div>
          </div>
          <div className="result-legend">
            {recommendationEntries.map(([label, count]) => (
              <button
                key={label}
                onClick={() =>
                  onQueueFilter({
                    kind: "recommendation",
                    recommendation: label,
                    period,
                    candidateIds: snapshot!.ready
                      .filter(
                        (candidate) =>
                          candidate.result?.recommendation === label,
                      )
                      .map((candidate) => candidate.id),
                  })
                }
              >
                <i style={{ background: recommendationColors[label] }} />
                <b>{count}</b>
                {label}
              </button>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}

function Vacancies({
  candidates,
  vacancyState,
  onState,
  onOpen,
  onNotify,
  onCandidatesDeleted,
  settingsNavigationRef,
}: {
  candidates: UiCandidate[];
  vacancyState: VacancyCreateState;
  onState: (state: VacancyCreateState) => void;
  onOpen: (id: CandidateId) => void;
  onNotify: (message: string) => void;
  onCandidatesDeleted: (vacancyId: string) => void;
  settingsNavigationRef?: MutableRefObject<VacancySettingsNavigation | null>;
}) {
  const vacancies = vacancyState.vacancies as UiVacancy[];
  const [scope, setScope] = useState<"active" | "archive">("active");
  const [vacancyQuery, setVacancyQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [tab, setTab] = useState("Кандидаты");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [generationOpen, setGenerationOpen] = useState(false);
  const [generationPrompt, setGenerationPrompt] = useState("");
  const [generationDefault, setGenerationDefault] = useState("");
  const [generationLoading, setGenerationLoading] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [generationConfirmation, setGenerationConfirmation] = useState(false);
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [generatedDraft, setGeneratedDraft] = useState<GeneratedCreationProfile | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [pendingTab, setPendingTab] = useState<string | null>(null);
  const [pendingGenerationTab, setPendingGenerationTab] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<"archive" | "delete" | null>(null);
  const generationLock = useRef(false);
  const localSettingsNavigation = useRef<VacancySettingsNavigation | null>(null);
  const settingsNavigation = settingsNavigationRef ?? localSettingsNavigation;
  const normalizedVacancyQuery = vacancyQuery.trim().toLocaleLowerCase("ru");
  const visible = vacancies.filter((item) =>
    (scope === "archive" ? item.archived : !item.archived) &&
    (!normalizedVacancyQuery || item.title.toLocaleLowerCase("ru").includes(normalizedVacancyQuery)),
  );
  const vacancy = visible.find((item) => item.id === selectedId) ?? visible[0];
  const openGeneration = async () => {
    if (!vacancy || vacancy.archived) return;
    setGenerationError("");
    setGenerationOpen(true);
    try {
      const response = await fetch(`/api/vacancies/prompts?vacancyId=${encodeURIComponent(vacancy.id)}`);
      const payload = await response.json() as VacancyPromptPayload & { error?: { message?: string } };
      if (!response.ok || !payload.generation) throw new Error(payload.error?.message ?? "Не удалось загрузить стандартную инструкцию");
      setGenerationPrompt(payload.generation.text);
      setGenerationDefault(payload.generation.text);
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "Не удалось загрузить инструкцию");
    }
  };
  const requestGeneration = () => {
    if (!vacancy || generationLock.current) return;
    const prompt = generationPrompt.replace(/\r\n?/g, "\n").trim();
    if (!prompt) { setGenerationError("Инструкция не должна быть пустой"); return; }
    setGenerationConfirmation(true);
  };
  const confirmAndGenerate = async () => {
    if (!vacancy || generationLock.current) return;
    const prompt = generationPrompt.replace(/\r\n?/g, "\n").trim();
    if (!prompt) { setGenerationError("Инструкция не должна быть пустой"); return; }
    generationLock.current = true;
    setGenerationLoading(true);
    setGenerationError("");
    try {
      const response = await fetch("/api/vacancies/generate", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken() },
        body: JSON.stringify({ operationId: crypto.randomUUID(), vacancyId: vacancy.id, title: vacancy.title, prompt }),
      });
      const payload = await response.json() as { operation?: { state: string; profile?: GeneratedCreationProfile }; error?: { message?: string } };
      if (!response.ok || payload.operation?.state !== "SUCCEEDED" || !payload.operation.profile) throw new Error(payload.error?.message ?? "Описание вакансии не удалось сформировать");
      const generated = payload.operation.profile;
      setGeneratedDraft(generated);
      setSettingsRevision((revision) => revision + 1);
      setGenerationOpen(false);
      setTab("Параметры оценки");
      onNotify("Описание вакансии готово. Проверьте разделы и нажмите «Сохранить»");
      playVacancyReadySound();
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "Описание вакансии не удалось сформировать");
    } finally {
      generationLock.current = false;
      setGenerationLoading(false);
    }
  };
  const requestTab = (nextTab: string) => {
    if (nextTab === tab) return;
    if (settingsNavigation.current?.isGenerating()) { setPendingGenerationTab(nextTab); return; }
    if (tab === "Параметры оценки" && settingsDirty) setPendingTab(nextTab);
    else setTab(nextTab);
  };
  const cancelGenerationAndNavigateTab = () => {
    const nextTab = pendingGenerationTab;
    settingsNavigation.current?.cancelGeneration();
    setPendingGenerationTab(null);
    if (!nextTab) return;
    if (settingsDirty) setPendingTab(nextTab); else setTab(nextTab);
  };
  const discardSettingsAndNavigate = () => {
    settingsNavigation.current?.discard();
    setGeneratedDraft(null);
    setSettingsDirty(false);
    if (pendingTab) setTab(pendingTab);
    setPendingTab(null);
  };
  const saveSettingsAndNavigate = async () => {
    if (!settingsNavigation.current || settingsSaving) return;
    setSettingsSaving(true);
    try {
      if (!await settingsNavigation.current.save()) return;
      setGeneratedDraft(null);
      setSettingsDirty(false);
      if (pendingTab) setTab(pendingTab);
      setPendingTab(null);
    } finally { setSettingsSaving(false); }
  };
  const runLifecycle = async (action: "archive" | "restore" | "delete") => {
    if (!vacancy || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/vacancies/lifecycle", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken(),
        },
        body: JSON.stringify({ vacancyId: vacancy.id, action }),
      });
      const payload = (await response.json()) as {
        vacancy?: VacancyRecord | null;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "Команда отклонена");
      const nextVacancies =
        action === "delete"
          ? vacancies.filter((item) => item.id !== vacancy.id)
          : vacancies.map((item) =>
              item.id === vacancy.id && payload.vacancy
                ? hydrateVacancy(payload.vacancy, vacancies.indexOf(item))
                : item,
            );
      onState({ ...vacancyState, vacancies: nextVacancies });
      if (action === "delete") onCandidatesDeleted(vacancy.id);
      setSelectedId("");
      if (action === "restore") setScope("active");
      onNotify(
        action === "archive"
          ? "Вакансия перемещена в архив"
          : action === "restore"
            ? "Вакансия восстановлена"
            : "Вакансия окончательно удалена",
      );
    } catch (error) {
      onNotify(
        error instanceof Error ? error.message : "Команда временно недоступна",
      );
    } finally {
      setBusy(false);
    }
  };
  const boundCandidates = vacancy
    ? candidates.filter((candidate) => candidate.vacancyId === vacancy.id)
    : [];
  return (
    <div className="page vacancies-page">
      <section className="page-title">
        <div>
          <p className="breadcrumb">Рабочее пространство / Вакансии</p>
          <h1>Вакансии</h1>
          <p>Активные профили оценки и архив вакансий.</p>
        </div>
        <button className="primary-button" onClick={() => setCreating(true)}>
          ＋ Новая вакансия
        </button>
      </section>
      <div className="vacancy-layout">
        <aside className="vacancy-sidebar panel">
          <div className="vacancy-scope" aria-label="Состояние вакансий">
            <button
              className={scope === "active" ? "active" : ""}
              onClick={() => {
                setScope("active");
                setSelectedId("");
              }}
            >
              Активные
            </button>
            <button
              className={scope === "archive" ? "active" : ""}
              onClick={() => {
                setScope("archive");
                setSelectedId("");
              }}
            >
              Архив
            </button>
          </div>
          <label className="mini-search vacancy-search">
            <span aria-hidden="true">⌕</span>
            <input
              aria-label="Найти вакансию"
              placeholder="Найти вакансию"
              value={vacancyQuery}
              onChange={(event) => {
                setVacancyQuery(event.target.value);
                setSelectedId("");
              }}
            />
          </label>
          <div className="vacancy-nav-list">
            {visible.map((item) => (
              <button
                className={vacancy?.id === item.id ? "active" : ""}
                key={item.id}
                onClick={() => setSelectedId(item.id)}
              >
                <i style={{ background: item.color }} />
                <span>
                  <b>{item.short}</b>
                  <small>
                    {
                      candidates.filter(
                        (candidate) => candidate.vacancyId === item.id,
                      ).length
                    }{" "}
                    кандидатов · {item.archived ? "в архиве" : "активна"}
                  </small>
                </span>
              </button>
            ))}
            {!visible.length && <p className="vacancy-search-empty">Вакансии не найдены.</p>}
          </div>
        </aside>
        {vacancy ? (
          <section className="vacancy-main panel">
            <header className="vacancy-header">
              <div className="vacancy-heading">
                <span
                  className="vacancy-avatar"
                  style={{ background: vacancy.color }}
                >
                  {vacancy.avatar}
                </span>
                <div>
                  <div className="vacancy-badges">
                    <span
                      className={`soft-badge ${vacancy.archived ? "archived" : ""}`}
                    >
                      {vacancy.archived ? "В архиве" : "Активна"}
                    </span>
                  </div>
                  <h2>{vacancy.title}</h2>
                </div>
              </div>
              <div className="vacancy-header-actions">
                {vacancy.archived ? (
                  <>
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => void runLifecycle("restore")}
                    >
                      Восстановить
                    </button>
                    <button
                      className="danger-button"
                      disabled={busy}
                      onClick={() => setConfirmation("delete")}
                    >
                      Удалить
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="generate-description-button"
                      disabled={busy}
                      onClick={() => void openGeneration()}
                    >
                      Сгенерировать описание
                    </button>
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => requestTab("Параметры оценки")}
                    >
                      ⚙ Настройки
                    </button>
                    <button
                      className="danger-button"
                      disabled={busy}
                      onClick={() => setConfirmation("archive")}
                    >
                      В архив
                    </button>
                  </>
                )}
              </div>
            </header>
            <div className="vacancy-tabs">
              {["Кандидаты", "Параметры оценки", "Активность"].map((item) => (
                <button
                  key={item}
                  onClick={() => requestTab(item)}
                  className={tab === item ? "active" : ""}
                >
                  {item}
                </button>
              ))}
            </div>
            {tab === "Кандидаты" ? (
              <VacancyCandidates candidates={boundCandidates} onOpen={onOpen} />
            ) : tab === "Параметры оценки" ? (
              <VacancySettings
                key={`${vacancy.id}:${settingsRevision}`}
                vacancy={vacancy}
                initialDraft={generatedDraft}
                onNotify={onNotify}
                onDirtyChange={setSettingsDirty}
                navigationRef={settingsNavigation}
                onSaved={(saved) => {
                  setGeneratedDraft(null);
                  onState({ ...vacancyState, vacancies: vacancies.map((item) => item.id === saved.id ? { ...item, ...saved } : item) });
                }}
              />
            ) : (
              <div className="activity-feed">
                <h3>Активность вакансии</h3>
                <article>
                  <i>✓</i>
                  <div>
                    <b>
                      {vacancy.archived
                        ? "Вакансия в архиве"
                        : "Вакансия активна"}
                    </b>
                  </div>
                </article>
              </div>
            )}
            {pendingGenerationTab && (
              <ConfirmationDialog
                title="Прервать генерацию и перейти?"
                description={<p>Генерация будет завершена, поле не будет заполнено.</p>}
                confirmLabel="Прервать и перейти"
                danger
                onCancel={() => setPendingGenerationTab(null)}
                onConfirm={cancelGenerationAndNavigateTab}
              />
            )}
            {pendingTab && UnsavedChangesDialog({
              busy: settingsSaving,
              onClose: () => setPendingTab(null),
              onDiscard: discardSettingsAndNavigate,
              onSave: () => void saveSettingsAndNavigate(),
            })}
          </section>
        ) : (
          <section className="vacancy-main panel vacancy-list-empty">
            <div className="vacancy-empty">
              <span>▤</span>
              <b>
                {scope === "archive"
                  ? "Архив вакансий пуст"
                  : "Активных вакансий пока нет"}
              </b>
              <p>
                {scope === "archive"
                  ? "Архивированные вакансии появятся здесь."
                  : "Создайте новую вакансию или восстановите её из архива."}
              </p>
            </div>
          </section>
        )}
      </div>
      {creating && (
        <CreateVacancy
          existing={vacancyState}
          onClose={() => setCreating(false)}
          onCreated={(state) => {
            onState(state);
            setScope("active");
            setSelectedId(state.vacancies.at(-1)?.id ?? "");
            setCreating(false);
            onNotify("Вакансия сохранена и активна");
          }}
        />
      )}
      {confirmation && vacancy && (
        <ConfirmationDialog
          title={confirmation === "archive" ? `Переместить вакансию «${vacancy.title}» в архив?` : `Удалить вакансию «${vacancy.title}»?`}
          description={confirmation === "archive" ? (
            <p>Новые кандидаты для этой вакансии не будут приниматься, пока вы её не восстановите.</p>
          ) : boundCandidates.length ? (
            <>
              <p>Вместе с вакансией будут безвозвратно удалены все связанные карточки кандидатов.</p>
              <div className="confirmation-summary">
                <b>{boundCandidates.length} {boundCandidates.length === 1 ? "кандидат" : boundCandidates.length < 5 ? "кандидата" : "кандидатов"}</b>
                <span>Активных: {boundCandidates.filter((candidate) => !candidate.archived).length}</span>
                <span>В архиве: {boundCandidates.filter((candidate) => candidate.archived).length}</span>
              </div>
              <p className="confirmation-warning">Это действие нельзя отменить.</p>
            </>
          ) : (
            <p>Вакансия будет безвозвратно удалена. Это действие нельзя отменить.</p>
          )}
          confirmLabel={confirmation === "archive" ? "В архив" : "Удалить"}
          danger={confirmation === "delete"}
          busy={busy}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            const action = confirmation;
            setConfirmation(null);
            void runLifecycle(action);
          }}
        />
      )}
      {generationOpen && vacancy && (
        <VacancyGenerationPromptModal
          vacancyTitle={vacancy.title}
          prompt={generationPrompt}
          defaultPrompt={generationDefault}
          loading={generationLoading}
          error={generationError}
          onPrompt={setGenerationPrompt}
          onGenerate={requestGeneration}
          onClose={() => {
            if (!generationLoading) {
              setGenerationConfirmation(false);
              setGenerationOpen(false);
            }
          }}
        />
      )}
      {generationConfirmation && vacancy && (
        <ConfirmationDialog
          title="Запустить генерацию описания вакансии?"
          description={<p>Будут заполнены все разделы вакансии, а все существующие значения во всех разделах будут перезаписаны.</p>}
          confirmLabel="Сгенерировать"
          danger
          onCancel={() => setGenerationConfirmation(false)}
          onConfirm={() => {
            setGenerationConfirmation(false);
            void confirmAndGenerate();
          }}
        />
      )}
    </div>
  );
}

function VacancyGenerationPromptModal({ vacancyTitle, prompt, defaultPrompt, loading, error, onPrompt, onGenerate, onClose }: {
  vacancyTitle: string;
  prompt: string;
  defaultPrompt: string;
  loading: boolean;
  error: string;
  onPrompt: (value: string) => void;
  onGenerate: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("textarea")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled)')];
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [loading, onClose]);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !loading) onClose(); }}>
      <div className="create-vacancy-modal generation-prompt-modal" role="dialog" aria-modal="true" aria-labelledby="generation-prompt-title" ref={dialogRef}>
        <header>
          <div><p className="eyebrow">{vacancyTitle}</p><h2 id="generation-prompt-title">Сгенерировать описание вакансии</h2></div>
          <button type="button" aria-label="Закрыть" disabled={loading} onClick={onClose}>×</button>
        </header>
        <p className="generation-prompt-help">Проверьте или дополните полный шаблон для вакансии «{vacancyTitle}». Генерация начнётся только после отдельного подтверждения.</p>
        <p className="generation-prompt-help">Формат результата и обязательные разделы закреплены системой и не изменяются этой инструкцией.</p>
        <label className="settings-field">
          <span>Инструкция для генерации</span>
          <textarea rows={18} maxLength={100000} value={prompt} disabled={loading} onChange={(event) => onPrompt(event.target.value)} />
          <small>{prompt.length.toLocaleString("ru-RU")} / 100 000 символов</small>
        </label>
        {error && <div className="abc-validation-summary" role="alert">{error}</div>}
        {loading && <div className="generation-status" role="status"><span className="loading-spinner" aria-hidden="true" /><span><b>Генерируем описание</b><small>Наполняем все разделы вакансии…</small></span></div>}
        <div className="settings-actions generation-prompt-actions">
          <button type="button" className="secondary-button" disabled={loading || !defaultPrompt} onClick={() => onPrompt(defaultPrompt)}>Вернуть стандартный текст</button>
          <button type="button" className="secondary-button" disabled={loading} onClick={onClose}>Отмена</button>
          <button type="button" className="primary-button" disabled={loading || !prompt.trim()} aria-busy={loading} onClick={onGenerate}>
            {loading && <span className="button-spinner" aria-hidden="true" />} {loading ? "Генерируем…" : "Сгенерировать"}
          </button>
        </div>
      </div>
    </div>
  );
}

function VacancyCandidates({
  candidates,
  onOpen,
}: {
  candidates: UiCandidate[];
  onOpen: (id: CandidateId) => void;
}) {
  const [query, setQuery] = useState("");
  const shown = candidates.filter((candidate) => candidate.name.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru")));
  return (
    <section className="vacancy-content vacancy-ranking-region">
        <div className="ranking-head ranking-toolbar">
        <div>
          <p className="eyebrow">Рейтинг по профилю вакансии</p>
          <h3>Кандидаты</h3>
        </div>
        <div className="table-tools"><label className="ranking-search"><span>⌕</span><input aria-label="Найти кандидата" placeholder="Найти кандидата" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
      </div>
      {candidates.length ? (
        <div className="ranking-table" role="table" aria-label="Рейтинг кандидатов">
          <div className="ranking-row labels" role="row"><span role="columnheader">#</span><span role="columnheader">Кандидат</span><span role="columnheader">Статус</span><span role="columnheader">Итог AI</span><span role="columnheader">Этап / время</span><span /></div>
          {shown.map((candidate, index) => {
            const ready = validateResultPair(candidate);
            const rankingProgress = ready
              ? 100
              : Number.isFinite(candidate.progressPercent)
                ? candidate.progressPercent!
                : 0;
            const aiResult = ready
              ? candidate.result!.recommendation
              : candidate.status === "FAILED"
                ? "Ошибка обработки"
                : "Ожидается";
            const aiResultTone = ready
              ? recommendationPresentation(candidate.result!.recommendation).tone
              : candidate.status === "FAILED"
                ? "reject"
                : "pending";
            return <button
              className="ranking-row"
              key={candidate.id}
              onClick={() => onOpen(candidate.id)}
            >
              <span>{index + 1}</span>
              <span className="candidate-cell">
                <i className={`avatar ${candidate.tone}`}>
                  {candidate.initials}
                </i>
                <i>
                  <b>{candidate.name}</b>
                  <small>{candidate.updated}</small>
                </i>
              </span>
              <StatusPill
                status={candidate.status}
                archived={candidate.archived}
              />
               <span className={`ai-result-cell ai-result-${aiResultTone}`}>{aiResult}</span>
               <span className="ranking-progress-cell"><CandidateProgress candidate={candidate} compact valueOverride={rankingProgress} /></span>
               <span>›</span>
             </button>;
           })}
          {!shown.length && <p className="ranking-empty">По запросу кандидаты не найдены.</p>}
        </div>
      ) : (
        <div className="vacancy-empty">
          <span>♙</span>
          <b>Кандидатов пока нет</b>
          <p>Добавьте материалы в связанную папку Google Drive.</p>
        </div>
      )}
    </section>
  );
}

function LegacyVacancySettingsDraft({
  vacancy,
  onNotify,
}: {
  vacancy: UiVacancy;
  onNotify: (message: string) => void;
}) {
  const [activeRule, setActiveRule] = useState("Образ результата");
  const [values, setValues] = useState(() => structuredClone(vacancy.profile));
  const [abcDirections, setAbcDirections] = useState(() =>
    structuredClone(vacancy.abcDirections),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const save = async () => {
    const abc = validateAbcProfile(abcDirections);
    const missing = Object.entries(values)
      .filter(([, value]) => !value.trim())
      .map(([key]) => key);
    const all = [...abc.errors.map((error) => error.message), ...missing];
    setErrors(all);
    if (!all.length) onNotify("Профиль вакансии сохранён");
  };
  return (
    <div className="settings-content">
      <aside>
        {[...Object.keys(values), "ABC-профиль"].map((item) => (
          <button
            key={item}
            className={activeRule === item ? "active" : ""}
            onClick={() => requestRule(item)}
          >
            {item}
          </button>
        ))}
      </aside>
      <section>
        <div className="settings-intro">
          <div>
            <p className="eyebrow">Параметры оценки</p>
            <h3>{activeRule}</h3>
          </div>
        </div>
        {errors.length > 0 && (
          <div className="abc-validation-summary" role="alert">
            {errors.join(" · ")}
          </div>
        )}
        {activeRule === "ABC-профиль" ? (
          <div className="abc-direction-editor">
            <div className="abc-direction-summary">
              <div>
                <b>ABC-направления</b>
                <p>Наблюдаемые определения A, B и C.</p>
              </div>
              <span>{abcDirections.length}</span>
            </div>
            {abcDirections.map((direction, index) => (
              <article className="abc-direction-card" key={direction.id}>
                <header>
                  <div>
                    <span className="direction-order">{index + 1}</span>
                  </div>
                  <button
                    onClick={() =>
                      setAbcDirections((items) =>
                        items.filter((item) => item.id !== direction.id),
                      )
                    }
                  >
                    Удалить
                  </button>
                </header>
                <label className="direction-name">
                  <span>Название</span>
                  <input
                    value={direction.name}
                    onChange={(event) =>
                      setAbcDirections((items) =>
                        items.map((item) =>
                          item.id === direction.id
                            ? { ...item, name: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
                <div className="abc-grade-grid">
                  {(["gradeA", "gradeB", "gradeC"] as const).map(
                    (field, gradeIndex) => (
                      <label key={field}>
                        <span
                          className={`grade-mark grade-${"abc"[gradeIndex]}`}
                        >
                          {"ABC"[gradeIndex]}
                        </span>
                        <textarea
                          value={direction[field]}
                          onChange={(event) =>
                            setAbcDirections((items) =>
                              items.map((item) =>
                                item.id === direction.id
                                  ? { ...item, [field]: event.target.value }
                                  : item,
                              ),
                            )
                          }
                        />
                      </label>
                    ),
                  )}
                </div>
              </article>
            ))}
            <div className="settings-actions">
              <button
                className="secondary-button"
                onClick={() => setAbcDirections(createStandardAbcDirections())}
              >
                Сбросить настройки
              </button>
              <button
                className="secondary-button"
                onClick={() =>
                  setAbcDirections((items) => [
                    ...items,
                    {
                      id: `custom-${Date.now()}`,
                      name: "",
                      gradeA: "",
                      gradeB: "",
                      gradeC: "",
                      origin: "custom",
                    },
                  ])
                }
              >
                ＋ Добавить направление
              </button>
              <button className="save-button" onClick={save}>
                Сохранить
              </button>
            </div>
          </div>
        ) : (
          <>
            <label className="settings-field">
              <span>Правила и наблюдаемые признаки</span>
              <textarea
                value={values[activeRule] ?? ""}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [activeRule]: event.target.value,
                  }))
                }
                rows={10}
              />
            </label>
            <div className="settings-actions">
              <button className="save-button" onClick={save}>
                Сохранить
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

void LegacyVacancySettingsDraft;

type VacancySettingsNavigation = {
  save: () => Promise<boolean>;
  discard: () => void;
  isGenerating: () => boolean;
  cancelGeneration: () => void;
};

export function VacancySettings({
  vacancy,
  initialDraft,
  onNotify,
  onSaved,
  onDirtyChange,
  navigationRef,
}: {
  vacancy: UiVacancy;
  initialDraft?: GeneratedCreationProfile | null;
  onNotify: (message: string) => void;
  onSaved?: (vacancy: VacancyRecord) => void;
  onDirtyChange?: (dirty: boolean) => void;
  navigationRef?: MutableRefObject<VacancySettingsNavigation | null>;
}) {
  const [activeRule, setActiveRule] = useState("Образ результата");
  const [version, setVersion] = useState<number>(vacancy.version);
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...(initialDraft?.profile ?? vacancy.profile),
  }));
  const [abcDirections, setAbcDirections] = useState<AbcProfileDirection[]>(
    () => (initialDraft?.abcDirections ?? vacancy.abcDirections).map((direction) => ({ ...direction })),
  );
  const [abcErrors, setAbcErrors] = useState<
    readonly AbcProfileValidationError[]
  >([]);
  const [generationError, setGenerationError] = useState("");
  const [saving, setSaving] = useState(false);
  const [analysisPrompt, setAnalysisPrompt] = useState(vacancy.analysisPrompt?.text ?? "");
  const [analysisDefault, setAnalysisDefault] = useState("");
  const [promptLoading, setPromptLoading] = useState(true);
  const [fieldPrompts, setFieldPrompts] = useState<Partial<Record<GenerationPromptKey, PromptSnapshot>>>({});
  const [fieldDefaults, setFieldDefaults] = useState<Partial<Record<GenerationPromptKey, PromptSnapshot>>>({});
  const [promptRevision, setPromptRevision] = useState(vacancy.generationPromptsRevision ?? 0);
  const [promptEditorKey, setPromptEditorKey] = useState<GenerationPromptKey | null>(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [generationKey, setGenerationKey] = useState<GenerationPromptKey | null>(null);
  const [generationConfirmation, setGenerationConfirmation] = useState<GenerationPromptKey | null>(null);
  const [pendingGenerationRule, setPendingGenerationRule] = useState<string | null>(null);
  const [pendingRule, setPendingRule] = useState<string | null>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const generationRunRef = useRef(0);
  const generationActiveRef = useRef(false);
  const savedSnapshot = useRef({ values: structuredClone(vacancy.profile), abcDirections: vacancy.abcDirections.map((item) => ({ ...item })), analysisPrompt: vacancy.analysisPrompt?.text ?? "" });
  const currentSnapshot = JSON.stringify({ values, abcDirections, analysisPrompt });
  const isDirty = currentSnapshot !== JSON.stringify(savedSnapshot.current);
  const sections = [
    "Образ результата",
    "ABC-критерии",
    "Компетенции",
    "Стоп-факторы",
    "Допуск к КЕ",
    "Промпт для анализа",
  ];
  useEffect(() => {
    let active = true;
    void fetch(`/api/vacancies/prompts?vacancyId=${encodeURIComponent(vacancy.id)}`).then(async (response) => {
      const payload = await response.json() as VacancyPromptPayload & { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "Не удалось загрузить промпт для анализа");
      if (active) {
        setAnalysisPrompt(payload.analysis.text); setAnalysisDefault(payload.analysisDefault.text);
        savedSnapshot.current.analysisPrompt = payload.analysis.text;
        setFieldPrompts(payload.fieldGenerationPrompts ?? {}); setFieldDefaults(payload.fieldGenerationDefaults ?? {});
        setPromptRevision(payload.generationPromptsRevision ?? 0);
      }
    }).catch((error) => { if (active) setGenerationError(error instanceof Error ? error.message : "Не удалось загрузить промпт для анализа"); })
      .finally(() => { if (active) setPromptLoading(false); });
    return () => { active = false; };
  }, [vacancy.id]);
  useEffect(() => {
    if (typeof window === "undefined" || (!isDirty && !generationKey)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty, generationKey]);
  useEffect(() => () => {
    generationRunRef.current += 1;
    generationActiveRef.current = false;
    generationAbortRef.current?.abort();
    generationAbortRef.current = null;
  }, []);
  const updateDirection = (
    id: string,
    field: AbcDirectionField,
    value: string,
  ) => {
    const next = abcDirections.map((item) =>
      item.id === id ? { ...item, [field]: value } : item,
    );
    setAbcDirections(next);
    if (abcErrors.length) setAbcErrors(validateAbcProfile(next).errors);
  };
  const removeAbcDirection = (id: string) => {
    const next = abcDirections.filter((item) => item.id !== id);
    setAbcDirections(next);
    if (abcErrors.length) setAbcErrors(validateAbcProfile(next).errors);
  };
  const save = async (): Promise<boolean> => {
    if (saving) return false;
    const validation = validateAbcProfile(abcDirections);
    if (!validation.valid) {
      setAbcErrors(validation.errors);
      onNotify(validation.errors[0].message);
      return false;
    }
    setAbcErrors([]); setGenerationError(""); setSaving(true);
    try {
      const response = await fetch("/api/vacancies/profile", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrfToken() }, body: JSON.stringify({ vacancyId: vacancy.id, expectedVersion: version, profile: values, abcDirections, templateVersion: initialDraft?.templateVersion ?? vacancy.templateVersion, analysisPrompt }) });
      const payload = await response.json() as { vacancy?: VacancyRecord; error?: string };
      if (!response.ok || !payload.vacancy) throw new Error(payload.error ?? "Не удалось сохранить профиль вакансии");
      setVersion(payload.vacancy.version);
      savedSnapshot.current = { values: structuredClone(payload.vacancy.profile), abcDirections: payload.vacancy.abcDirections.map((item) => ({ ...item })), analysisPrompt: payload.vacancy.analysisPrompt?.text ?? analysisPrompt };
      onSaved?.(payload.vacancy);
      onNotify(activeRule === "Промпт для анализа" ? "Промпт для анализа сохранён" : "Профиль вакансии сохранён");
      return true;
    } catch (reason) { const message = reason instanceof Error ? reason.message : "Не удалось сохранить профиль вакансии"; setGenerationError(message); onNotify(message); return false; }
    finally { setSaving(false); }
  };
  const errorFor = (directionId: string, field: AbcDirectionField) =>
    abcErrors.find(
      (error) =>
        error.level !== "collection" &&
        error.directionId === directionId &&
        error.field === field,
    );
  const errorId = (directionId: string, field: AbcDirectionField) =>
    `abc-${directionId.replace(/[^a-zA-Z0-9_-]/g, "-")}-${field}-error`;
  const cancelGeneration = () => {
    generationRunRef.current += 1;
    generationActiveRef.current = false;
    generationAbortRef.current?.abort();
    generationAbortRef.current = null;
    setGenerationKey(null);
    setGenerationConfirmation(null);
  };
  const requestRule = (item: string) => {
    if (item === activeRule) return;
    if (generationKey) { setPendingGenerationRule(item); return; }
    if (isDirty) setPendingRule(item); else setActiveRule(item);
  };
  const cancelGenerationAndContinue = () => {
    const nextRule = pendingGenerationRule;
    cancelGeneration();
    setPendingGenerationRule(null);
    if (!nextRule) return;
    if (isDirty) setPendingRule(nextRule); else setActiveRule(nextRule);
  };
  const discardAndContinue = () => {
    setValues(structuredClone(savedSnapshot.current.values));
    setAbcDirections(savedSnapshot.current.abcDirections.map((item) => ({ ...item })));
    setAnalysisPrompt(savedSnapshot.current.analysisPrompt);
    if (pendingRule) setActiveRule(pendingRule);
    setPendingRule(null); setGenerationError(""); setAbcErrors([]);
  };
  const discard = () => {
    setValues(structuredClone(savedSnapshot.current.values));
    setAbcDirections(savedSnapshot.current.abcDirections.map((item) => ({ ...item })));
    setAnalysisPrompt(savedSnapshot.current.analysisPrompt);
    setGenerationError(""); setAbcErrors([]);
  };
  if (navigationRef) navigationRef.current = {
    save,
    discard,
    isGenerating: () => generationActiveRef.current,
    cancelGeneration,
  };
  useEffect(() => {
    onDirtyChange?.(isDirty);
    return () => onDirtyChange?.(false);
  }, [isDirty, onDirtyChange]);
  const saveAndContinue = async () => {
    if (!await save()) return;
    if (pendingRule) setActiveRule(pendingRule);
    setPendingRule(null);
  };
  const openPromptEditor = (key: GenerationPromptKey) => {
    setPromptEditorKey(key); setPromptDraft(fieldPrompts[key]?.text ?? fieldDefaults[key]?.text ?? ""); setGenerationError("");
  };
  const saveGenerationPrompt = async () => {
    if (!promptEditorKey || !promptDraft.trim()) return;
    try {
      const response = await fetch("/api/vacancies/prompts", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrfToken() }, body: JSON.stringify({ vacancyId: vacancy.id, expectedRevision: promptRevision, key: promptEditorKey, prompt: promptDraft }) });
      const payload = await response.json() as { prompt?: PromptSnapshot; generationPromptsRevision?: number; error?: { message?: string } };
      if (!response.ok || !payload.prompt) throw new Error(payload.error?.message ?? "Промпт не удалось сохранить");
      setFieldPrompts((current) => ({ ...current, [promptEditorKey]: payload.prompt }));
      setPromptRevision(payload.generationPromptsRevision ?? promptRevision + 1); setPromptEditorKey(null); onNotify("Промпт генерации сохранён");
    } catch (error) { setGenerationError(error instanceof Error ? error.message : "Промпт не удалось сохранить"); }
  };
  const runSectionGeneration = async (key: GenerationPromptKey) => {
    if (generationActiveRef.current) return;
    if (key === "ABC-критерии" && !abcDirections.length) { onNotify("Сначала добавьте хотя бы одно ABC-направление"); return; }
    const runId = generationRunRef.current + 1;
    generationRunRef.current = runId;
    const controller = new AbortController();
    generationAbortRef.current = controller;
    generationActiveRef.current = true;
    setGenerationConfirmation(null); setGenerationKey(key); setGenerationError("");
    try {
      const response = await fetch("/api/vacancies/generate", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json", "x-csrf-token": csrfToken() }, body: JSON.stringify({ operationId: crypto.randomUUID(), vacancyId: vacancy.id, operationType: key === "ABC-критерии" ? "abc" : "field", field: key, abcDirections: key === "ABC-критерии" ? abcDirections : undefined }) });
      const payload = await response.json() as { operation?: { state?: string; result?: { field?: string; text?: string; abcDirections?: AbcProfileDirection[] } }; error?: { message?: string } };
      if (controller.signal.aborted || generationRunRef.current !== runId) return;
      if (!response.ok || payload.operation?.state !== "SUCCEEDED" || !payload.operation.result) throw new Error(payload.error?.message ?? "Описание не удалось сформировать");
      if (key === "ABC-критерии") {
        if (!Array.isArray(payload.operation.result.abcDirections)) throw new Error("Модель вернула некорректные ABC-описания");
        setAbcDirections(payload.operation.result.abcDirections.map((item) => ({ ...item })));
      } else {
        if (payload.operation.result.field !== key || !payload.operation.result.text?.trim()) throw new Error("Модель вернула некорректное описание");
        setValues((current) => ({ ...current, [key]: payload.operation!.result!.text! }));
      }
      onNotify(`Описание раздела «${key}» готово. Нажмите «Сохранить»`);
    } catch (error) {
      if (controller.signal.aborted || generationRunRef.current !== runId) return;
      const message = error instanceof Error ? error.message : "Описание не удалось сформировать"; setGenerationError(message); onNotify(message);
    }
    finally {
      if (generationRunRef.current === runId) {
        generationActiveRef.current = false;
        generationAbortRef.current = null;
        setGenerationKey(null);
      }
    }
  };
  return (
    <div className="settings-content" data-profile-version={version}>
      <aside>
        {sections.map((item) => (
          <button
            key={item}
            className={activeRule === item ? "active" : ""}
            onClick={() => requestRule(item)}
          >
            {item}
            <span>›</span>
          </button>
        ))}
      </aside>
      <section>
        <div className="settings-intro">
          <div>
            <p className="eyebrow">{vacancy.title}</p>
            <h3>{activeRule}</h3>
          </div>
        </div>
        {generationError && (
          <div className="abc-validation-summary" role="alert">
            {generationError}
          </div>
        )}
        {activeRule === "ABC-критерии" ? (
          <div className="abc-direction-editor">
            <div className="abc-field-tools inline-field-tools">
              {abcDirections.length > 0 && <>
                <button className="field-tool-button prompt-tool" type="button" aria-label="Промпт генерации ABC-критериев" title="Промпт генерации" disabled={promptLoading || Boolean(generationKey)} onClick={() => openPromptEditor("ABC-критерии")}>Prompt</button>
                <button className="field-tool-button ai-tool generate-description-button" type="button" aria-label="Сгенерировать описания A, B и C" title="Сгенерировать описания A, B и C" disabled={Boolean(generationKey)} onClick={() => setGenerationConfirmation("ABC-критерии")}>
                  {generationKey === "ABC-критерии" ? <span className="button-spinner" aria-hidden="true" /> : <><span aria-hidden="true">✦</span> AI</>}
                </button>
              </>}
            </div>
            <div className="abc-direction-list">
              {abcDirections.map((direction, index) => {
                const nameError = errorFor(direction.id, "name");
                return (
                  <article className="abc-direction-card" key={direction.id}>
                    <header>
                      <div>
                        <span className="direction-order">{index + 1}</span>
                        <em>
                          {direction.origin === "standard"
                            ? "Стандартное"
                            : "Добавлено HR"}
                        </em>
                      </div>
                      <button onClick={() => removeAbcDirection(direction.id)}>
                        Удалить
                      </button>
                    </header>
                    <label className="direction-name">
                      <span>Название направления</span>
                      <input
                        value={direction.name}
                        onChange={(event) =>
                          updateDirection(
                            direction.id,
                            "name",
                            event.target.value,
                          )
                        }
                        aria-invalid={Boolean(nameError)}
                        aria-describedby={
                          nameError ? errorId(direction.id, "name") : undefined
                        }
                      />
                      {nameError && (
                        <span
                          className="abc-field-error"
                          id={errorId(direction.id, "name")}
                          role="alert"
                        >
                          {nameError.message}
                        </span>
                      )}
                    </label>
                    <div className="abc-grade-grid">
                      {(["A", "B", "C"] as const).map((grade) => {
                        const field = `grade${grade}` as
                          "gradeA" | "gradeB" | "gradeC";
                        const fieldError = errorFor(direction.id, field);
                        return (
                          <label key={grade}>
                            <span
                              className={`grade-mark grade-${grade.toLowerCase()}`}
                            >
                              {grade}
                            </span>
                            <textarea
                              value={direction[field]}
                              onChange={(event) =>
                                updateDirection(
                                  direction.id,
                                  field,
                                  event.target.value,
                                )
                              }
                              aria-invalid={Boolean(fieldError)}
                              aria-describedby={
                                fieldError
                                  ? errorId(direction.id, field)
                                  : undefined
                              }
                            />
                            {fieldError && (
                              <span
                                className="abc-field-error"
                                id={errorId(direction.id, field)}
                                role="alert"
                              >
                                {fieldError.message}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </div>
            {abcDirections.length === 0 && (
              <div className="abc-empty-state">
                <b>Направлений пока нет</b>
                <p>Добавьте хотя бы одно направление, чтобы сгенерировать описания A, B и C.</p>
              </div>
            )}
            <div className="settings-actions">
              <button
                className="secondary-button"
                onClick={() => setAbcDirections(createStandardAbcDirections())}
              >
                Сбросить настройки
              </button>
              <button
                className="secondary-button"
                onClick={() =>
                  setAbcDirections((items) => [
                    ...items,
                    {
                      id: `custom-${Date.now()}`,
                      name: "Новое направление",
                      gradeA: "",
                      gradeB: "",
                      gradeC: "",
                      origin: "custom",
                    },
                  ])
                }
              >
                ＋ Добавить направление
              </button>
              <span className="settings-version-note">Изменения применяются только к новым запускам после сохранения</span>
              <button className="save-button" onClick={() => void save()}>Сохранить</button>
            </div>
          </div>
        ) : activeRule === "Промпт для анализа" ? (
          <>
            <label className="settings-field">
              <span>Промпт для анализа</span>
              <textarea rows={16} maxLength={100000} disabled={promptLoading} value={analysisPrompt} onChange={(event) => setAnalysisPrompt(event.target.value)} />
              <small>{analysisPrompt.length.toLocaleString("ru-RU")} / 100 000 символов</small>
            </label>
            <div className="settings-actions">
              <button className="secondary-button" disabled={promptLoading || !analysisDefault} onClick={() => setAnalysisPrompt(analysisDefault)}>Вернуть стандартный текст</button>
              <span className="settings-version-note">Изменения применяются только к новым запускам после сохранения</span>
              <button className="save-button" disabled={promptLoading || !analysisPrompt.trim()} onClick={() => void save()}>Сохранить</button>
            </div>
          </>
        ) : (
          <>
            <div className="settings-field">
              <div className="settings-field-head">
                <label htmlFor="vacancy-description-field">Правила и наблюдаемые признаки</label>
                <div className="inline-field-tools">
                  {!(values[activeRule] ?? "").trim() && <>
                    <button className="field-tool-button prompt-tool" type="button" aria-label={`Промпт генерации раздела «${activeRule}»`} title="Промпт генерации" disabled={promptLoading || Boolean(generationKey)} onClick={() => openPromptEditor(activeRule as GenerationPromptKey)}>Prompt</button>
                    <button className="field-tool-button ai-tool generate-description-button" type="button" aria-label={`Сгенерировать описание раздела «${activeRule}»`} title="Сгенерировать описание" disabled={Boolean(generationKey)} onClick={() => setGenerationConfirmation(activeRule as GenerationPromptKey)}>
                      {generationKey === activeRule ? <span className="button-spinner" aria-hidden="true" /> : <><span aria-hidden="true">✦</span> AI</>}
                    </button>
                  </>}
                </div>
              </div>
              <textarea
                id="vacancy-description-field"
                wrap="soft"
                value={values[activeRule] ?? ""}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [activeRule]: event.target.value,
                  }))
                }
                rows={10}
              />
            </div>
            <div className="settings-actions">
              <span className="settings-version-note">Изменения применяются только к новым запускам после сохранения</span>
              <button className="save-button" onClick={() => void save()}>Сохранить</button>
            </div>
          </>
        )}
      </section>
      {generationConfirmation && (
        <ConfirmationDialog
          title={`Сгенерировать описание «${generationConfirmation}»?`}
          description={<p>Модель заполнит только это поле. Результат останется черновиком до нажатия «Сохранить».</p>}
          confirmLabel="Сгенерировать"
          busy={Boolean(generationKey)}
          onCancel={() => setGenerationConfirmation(null)}
          onConfirm={() => void runSectionGeneration(generationConfirmation)}
        />
      )}
      {promptEditorKey && (
        <GenerationPromptEditorModal
          vacancyTitle={vacancy.title}
          operation={promptEditorKey}
          prompt={promptDraft}
          defaultPrompt={fieldDefaults[promptEditorKey]?.text ?? ""}
          busy={promptLoading}
          error={generationError}
          onPrompt={setPromptDraft}
          onReset={() => setPromptDraft(fieldDefaults[promptEditorKey]?.text ?? "")}
          onClose={() => setPromptEditorKey(null)}
          onSave={() => void saveGenerationPrompt()}
        />
      )}
      {pendingRule && UnsavedChangesDialog({
          busy: saving,
          onClose: () => setPendingRule(null),
          onDiscard: discardAndContinue,
          onSave: () => void saveAndContinue(),
        })}
      {pendingGenerationRule && (
        <ConfirmationDialog
          title="Прервать генерацию и перейти?"
          description={<p>Генерация будет завершена, поле не будет заполнено.</p>}
          confirmLabel="Прервать и перейти"
          danger
          onCancel={() => setPendingGenerationRule(null)}
          onConfirm={cancelGenerationAndContinue}
        />
      )}
    </div>
  );
}

function GenerationPromptEditorModal({ vacancyTitle, operation, prompt, defaultPrompt, busy, error, onPrompt, onReset, onClose, onSave }: {
  vacancyTitle: string; operation: GenerationPromptKey; prompt: string; defaultPrompt: string; busy: boolean; error: string;
  onPrompt: (value: string) => void; onReset: () => void; onClose: () => void; onSave: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("textarea")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled)')];
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);
  return <div className="modal-backdrop" role="presentation">
    <section ref={dialogRef} className="create-vacancy-modal generation-field-prompt-modal" role="dialog" aria-modal="true" aria-labelledby="field-prompt-title">
      <header><div><p className="eyebrow">{vacancyTitle}</p><h2 id="field-prompt-title">Промпт: {operation}</h2></div><button type="button" aria-label="Закрыть" disabled={busy} onClick={onClose}>×</button></header>
      <p className="generation-prompt-help">Этот промпт применяется только к выбранной операции и сохраняется отдельно для этой вакансии.</p>
      <label className="settings-field"><span>Промпт запроса к модели</span><textarea rows={16} maxLength={100000} disabled={busy} value={prompt} onChange={(event) => onPrompt(event.target.value)} /><small>{prompt.length.toLocaleString("ru-RU")} / 100 000 символов</small></label>
      {error && <div className="abc-validation-summary" role="alert">{error}</div>}
      <div className="settings-actions"><button className="secondary-button" type="button" disabled={busy || !defaultPrompt} onClick={onReset}>Вернуть стандартный текст</button><button className="secondary-button" type="button" disabled={busy} onClick={onClose}>Отмена</button><button className="primary-button" type="button" disabled={busy || !prompt.trim()} onClick={onSave}>Сохранить промпт</button></div>
    </section>
  </div>;
}

function UnsavedChangesDialog({ busy, onClose, onDiscard, onSave }: { busy: boolean; onClose: () => void; onDiscard: () => void; onSave: () => void }) {
  return <div className="modal-backdrop confirmation-backdrop" role="presentation">
    <section className="confirmation-modal unsaved-changes-modal panel" role="dialog" aria-modal="true" aria-labelledby="unsaved-title">
      <button className="modal-close-button" type="button" aria-label="Закрыть" disabled={busy} onClick={onClose}>×</button>
      <div className="confirmation-copy"><h2 id="unsaved-title">Покинуть раздел без сохранения?</h2><p>Несохранённые изменения будут сброшены.</p></div>
      <div className="confirmation-actions"><button className="danger-button red-action" disabled={busy} onClick={onDiscard}>Не сохранять</button><button autoFocus className="primary-button blue-action" disabled={busy} onClick={onSave}>{busy ? "Сохраняем…" : "Сохранить изменения"}</button></div>
    </section>
  </div>;
}

type GeneratedCreationProfile = {
  schemaVersion: string;
  templateVersion: string;
  profile: Record<string, string>;
  abcDirections: AbcProfileDirection[];
  hrDecisionMarkers: string[];
};

function stableCreationJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(stableCreationJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([key, item]) => `${JSON.stringify(key)}:${stableCreationJson(item)}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}

async function creationSnapshotHash(
  title: string,
  generated: GeneratedCreationProfile,
) {
  const bytes = new TextEncoder().encode(
    stableCreationJson({
      title: title.trim().replace(/\s+/g, " "),
      profile: generated.profile,
      abcDirections: generated.abcDirections,
      templateVersion: generated.templateVersion,
    }),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

function CreateVacancy({
  existing,
  onClose,
  onCreated,
}: {
  existing: VacancyCreateState;
  onClose: () => void;
  onCreated: (state: VacancyCreateState) => void;
}) {
  const [title, setTitle] = useState("");
  const [operationId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const close = () => {
    if (!busy) onClose();
  };
  const saveVacancy = async () => {
    const message = validateVacancyTitle(title, existing.vacancies);
    setError(message ?? "");
    if (message || busy) return;
    setBusy(true);
    setError("");
    try {
    const response = await fetch("/api/vacancies", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken(),
      },
      body: JSON.stringify({
        operationId,
        title,
        profile: {
          "Образ результата": "",
          Компетенции: "",
          "Стоп-факторы": "",
          "Допуск к КЕ": "",
        },
        abcDirections: [],
        templateVersion: "vacancy-empty/v1",
      }),
    });
    const payload = (await response.json()) as {
      vacancy?: VacancyRecord;
      error?: string;
    };
    if (!response.ok || !payload.vacancy)
      throw new Error(
        payload.error ?? "Не удалось сохранить и активировать вакансию",
      );
    const vacancy = {
      ...payload.vacancy,
      short: payload.vacancy.title,
      avatar: payload.vacancy.title.slice(0, 2).toUpperCase(),
      color: "#58dfc4",
    } satisfies UiVacancy;
    onCreated({
      vacancies: [...existing.vacancies, vacancy],
      operationBindings: {
        ...existing.operationBindings,
        [operationId]: {
          vacancyId: vacancy.id,
          folderId: vacancy.driveFolderId,
        },
      },
    });
    onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось сохранить вакансию",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="create-vacancy-modal panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-title"
      >
        <header>
          <h2 id="create-title">Новая вакансия</h2>
          <button disabled={busy} onClick={close} aria-label="Закрыть">
            ×
          </button>
        </header>
        {error && (
          <div className="abc-validation-summary" role="alert">
            {error}
          </div>
        )}
        <div className="create-title-step">
          <label className="settings-field">
            <span>Название вакансии *</span>
            <input
              value={title}
              disabled={busy}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          {busy && (
            <div
              className="generation-status"
              role="status"
              aria-live="polite"
              aria-busy={true}
            >
              <span className="loading-spinner" aria-hidden="true" />
              <span>
                <b>Сохраняем вакансию</b>
                <small>Создаём папку и связываем рабочее пространство…</small>
              </span>
            </div>
          )}
          <div className="settings-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={close}
            >
              Отмена
            </button>
            <button className="primary-button" disabled={busy} onClick={() => void saveVacancy()}>{busy ? "Сохраняем…" : <span>Сохранить</span>}</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function Candidates({
  items,
  vacancies,
  onOpen,
  dashboardFilter,
  onClearDashboardFilter,
}: {
  items: UiCandidate[];
  vacancies: UiVacancy[];
  onOpen: (id: CandidateId) => void;
  dashboardFilter: QueueFilter;
  onClearDashboardFilter: () => void;
}) {
  const [filter, setFilter] = useState("ACTIVE");
  const [vacancyId, setVacancyId] = useState("ALL");
  const matchesDashboardFilter = (candidate: UiCandidate) => {
    if (!dashboardFilter) return true;
    if (dashboardFilter.kind === "archive") return candidate.archived;
    if (dashboardFilter.kind === "recommendation")
      return dashboardFilter.candidateIds.includes(candidate.id);
    return candidate.status === dashboardFilter.status;
  };
  const archiveMode =
    filter === "ARCHIVE" || dashboardFilter?.kind === "archive";
  const shown = items.filter(
    (candidate) =>
      (archiveMode
        ? candidate.archived
        : !candidate.archived &&
          (filter === "ACTIVE" || candidate.status === filter)) &&
      (vacancyId === "ALL" || candidate.vacancyId === vacancyId) &&
      matchesDashboardFilter(candidate),
  );
  const dashboardFilterLabel =
    dashboardFilter?.kind === "recommendation"
      ? `${dashboardFilter.recommendation} · ${dashboardFilter.period} дней`
      : dashboardFilter?.kind === "archive"
        ? "Архив"
        : dashboardFilter
          ? WORKFLOW_LABELS[dashboardFilter.status]
          : "";
  return (
    <div className="page candidates-page">
      <section className="page-title">
        <div>
          <p className="breadcrumb">Рабочее пространство / Кандидаты</p>
          <h1>Все кандидаты</h1>
          <p>Workflow status и актуальные результаты без кадрового pipeline.</p>
        </div>
      </section>
      <section className="panel candidates-panel">
        <div className="candidate-toolbar">
          <div className="candidate-filters">
            {[
              ["ACTIVE", "Все"],
              ...Object.entries(WORKFLOW_LABELS),
              ["ARCHIVE", "Архив"],
            ].map(([key, label]) => (
              <button
                key={key}
                className={
                  filter === key ||
                  (key === "ARCHIVE" && dashboardFilter?.kind === "archive")
                    ? "active"
                    : ""
                }
                onClick={() => {
                  setFilter(key);
                  onClearDashboardFilter();
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="vacancy-filter">
            <span>Вакансия</span>
            <select
              value={vacancyId}
              onChange={(event) => setVacancyId(event.target.value)}
            >
              <option value="ALL">Все вакансии</option>
              {vacancies.map((vacancy) => (
                <option key={vacancy.id} value={vacancy.id}>
                  {vacancy.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        {dashboardFilter && (
          <div className="dashboard-queue-filter" role="status">
            <span>
              Фильтр dashboard: <b>{dashboardFilterLabel}</b>
            </span>
            <button onClick={onClearDashboardFilter}>Показать всех</button>
          </div>
        )}
        <div className="candidate-card-grid">
          {shown.map((candidate) => (
            <article className="candidate-card" key={candidate.id}>
              <button
                className="candidate-card-hit"
                onClick={() => onOpen(candidate.id)}
                aria-label={`Открыть карточку ${candidate.name}`}
              />
              <div className="candidate-card-top">
                <span className={`avatar large ${candidate.tone}`}>
                  {candidate.initials}
                </span>
                <StatusPill
                  status={candidate.status}
                  archived={candidate.archived}
                />
              </div>
              <h3>{candidate.name}</h3>
              <p>{candidate.vacancy}</p>
              {!candidate.archived && candidate.status !== "READY" && (
                <div className="candidate-score">
                  <span>
                    <small>Текущий этап</small>
                    <b>{WORKFLOW_LABELS[candidate.status]}</b>
                  </span>
                </div>
              )}
              <CandidateProgress candidate={candidate} />
              <footer className="candidate-card-footer">
                {candidate.status === "READY" && Number.isFinite(candidate.elapsedMinutes) && (
                  <span className="candidate-processing-duration" aria-label={`Время обработки: ${Math.max(0, Math.round(candidate.elapsedMinutes))} мин`}>
                    {Math.max(0, Math.round(candidate.elapsedMinutes))} мин
                  </span>
                )}
                <span className="candidate-card-result">
                  {candidate.result?.recommendation ??
                    candidate.failureReason ??
                    "Результат ещё не опубликован"}
                </span>
              </footer>
            </article>
          ))}
        </div>
        {!shown.length && (
          <div className="empty-state">
            {archiveMode
              ? "В архиве кандидатов нет."
              : "По выбранным фильтрам кандидатов нет."}
          </div>
        )}
      </section>
    </div>
  );
}

function recommendationPresentation(recommendation: Recommendation) {
  if (recommendation === "Рекомендовать") return { tone: "recommend" } as const;
  if (recommendation === "Рекомендовать с оговорками") return { tone: "caution" } as const;
  if (recommendation === "Не рекомендовать") return { tone: "reject" } as const;
  return { tone: "insufficient" } as const;
}

function RecommendationIcon({ tone }: { tone: ReturnType<typeof recommendationPresentation>["tone"] }) {
  return (
    <svg className="recommendation-icon" viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {tone === "recommend" && <polyline points="5 12.5 9.5 17 19 7" />}
      {tone === "caution" && <><line x1="12" y1="6" x2="12" y2="13.5" /><circle cx="12" cy="17.5" r="1" /></>}
      {tone === "reject" && <><line x1="7" y1="7" x2="17" y2="17" /><line x1="17" y1="7" x2="7" y2="17" /></>}
      {tone === "insufficient" && <><path d="M8.7 9a3.4 3.4 0 1 1 5.1 2.94c-1.08.64-1.8 1.18-1.8 2.56" /><circle cx="12" cy="18" r="1" /></>}
    </svg>
  );
}

function CandidateDetail({
  candidate,
  onBack,
  onArchive,
  onRestore,
  onDelete,
  onReprocess,
  onPreview,
}: {
  candidate: UiCandidate;
  onBack: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
  onReprocess: () => void;
  onPreview: (preview: Preview) => void;
}) {
  const [tab, setTab] = useState("AI-обзор");
  const [resolutionError, setResolutionError] = useState("");
  const [resolving, setResolving] = useState(false);
  const ready = validateResultPair(candidate);
  const processing =
    isProcessingStatus(candidate.status) ||
    candidate.status === "WAITING_FOR_STABILITY";
  const escalation =
    candidate.status === "WAITING_FOR_HUMAN" ? candidate.escalation : undefined;
  const processingPercent = Number.isFinite(candidate.progressPercent)
    ? Math.min(100, Math.max(0, Math.round(candidate.progressPercent!)))
    : null;
  const heroPercent = processingPercent;
  const recommendationStyle = ready ? recommendationPresentation(candidate.result!.recommendation) : null;
  const resolveEscalation = async (action: string) => {
    if (!escalation || resolving) return;
    setResolving(true);
    setResolutionError("");
    try {
      const response = await fetch("/api/candidates/escalation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken(),
        },
        body: JSON.stringify({
          escalationId: escalation.id,
          expectedVersion: escalation.version,
          action,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Действие отклонено");
      window.location.reload();
    } catch (error) {
      setResolutionError(
        error instanceof Error ? error.message : "Действие отклонено",
      );
      setResolving(false);
    }
  };
  return (
    <div className={`page candidate-detail-page ${ready ? "candidate-detail-ready" : "candidate-detail-processing"}`}>
      <button className="back-button" onClick={onBack}>
        ← Назад к списку
      </button>
      <section className={`candidate-hero panel ${ready ? "candidate-hero-ready" : "candidate-hero-processing"}`}>
        <div className="candidate-identity">
          <span className={`avatar xlarge ${candidate.tone}`}>
            {candidate.initials}
          </span>
          <div className="candidate-identity-content">
            <div className="candidate-identity-primary">
              <h1>{candidate.name}</h1>
              <StatusPill
                status={candidate.status}
                archived={candidate.archived}
              />
            </div>
            <span className="candidate-vacancy">{candidate.vacancy}</span>
          </div>
        </div>
        {!ready && <div className="hero-score">
          <div
            className={`score-ring hero-score-indicator ${heroPercent === null ? "score-ring-pending" : "score-ring-value"}`}
            role={heroPercent === null ? undefined : "progressbar"}
            aria-label={`Прогресс обработки: ${candidate.progressMilestone?.trim() || WORKFLOW_LABELS[candidate.status]}`}
            aria-valuenow={heroPercent ?? undefined}
            aria-valuemin={heroPercent === null ? undefined : 0}
            aria-valuemax={heroPercent === null ? undefined : 100}
            style={{ background: heroPercent === null ? "var(--score-track)" : `conic-gradient(var(--success-ink) 0 ${heroPercent}%, var(--score-track) ${heroPercent}% 100%)` }}
          ><span><b>{heroPercent === null ? (processing ? "…" : "—") : `${heroPercent}%`}</b><small>{heroPercent === null ? "итог" : "из 100"}</small></span></div>
          <div className="hero-stage">
            <small>Текущий этап</small>
            <h2>{candidate.progressMilestone?.trim() || WORKFLOW_LABELS[candidate.status]}</h2>
            <p>
              {candidate.status === "FAILED"
                ? `${candidate.failedStage}: ${candidate.failureReason}`
                : (escalation?.obstacle ?? (candidate.etaMinutes === null ? "Прогноз времени формируется" : `Осталось примерно ${candidate.etaMinutes} мин`))}
            </p>
          </div>
        </div>}
        <div className="hero-actions">
          {!candidate.archived && candidate.status !== "WAITING_FOR_HUMAN" && (
            <button
              className="secondary-button"
              disabled={!canReprocess(candidate)}
              title={
                processing
                  ? "Повтор будет доступен после завершения текущего запуска"
                  : undefined
              }
              onClick={onReprocess}
            >
              ↻ Повторная обработка
            </button>
          )}
          {candidate.archived ? (
            <>
              <button className="secondary-button" onClick={onRestore}>
                Восстановить
              </button>
              <button className="danger-button" onClick={onDelete}>
                Удалить
              </button>
            </>
          ) : (
            <button
              className="danger-button"
              disabled={!canArchive(candidate)}
              title={
                !canArchive(candidate)
                  ? "Архивирование доступно после завершения обработки"
                  : undefined
              }
              onClick={onArchive}
            >
              В архив
            </button>
          )}
        </div>
      </section>
      {ready ? (
        <>
          <section className="candidate-tabs">
            {["AI-обзор", "Транскрипция"].map((item) => (
              <button
                key={item}
                onClick={() => setTab(item)}
                className={tab === item ? "active" : ""}
              >
                {item}
              </button>
            ))}
          </section>
          {tab === "AI-обзор" ? (
            <section className="candidate-overview">
              <div className="overview-main">
                <article className="panel ai-summary decision-summary-card candidate-decision-region">
                  <div className="recommendation-heading">
                    <div>
                      <p className="eyebrow">Исследование AI</p>
                      <h2>Резюме для принятия решения</h2>
                    </div>
                    <span>Версия {candidate.result!.version}</span>
                  </div>
                  <p className="lead">{candidateDecisionSummary(candidate)}</p>
                  <div className={`ai-recommendation-callout recommendation-${recommendationStyle!.tone}`}>
                    <RecommendationIcon tone={recommendationStyle!.tone} />
                    <div><b>Итог AI</b><p>{candidate.result!.recommendation}</p>{candidate.result!.aiOverview && <small>{candidateRecommendationBasis(candidate.result!.aiOverview)}</small>}</div>
                  </div>
                </article>
                {candidate.result!.aiOverview ? (
                  <AiOverviewDetails overview={candidate.result!.aiOverview} />
                ) : (
                  <AssessmentUnavailable />
                )}
              </div>
              <aside className="candidate-review-aside candidate-matching-region">
                {candidate.result!.aiOverview && <AssessmentAside overview={candidate.result!.aiOverview} />}
                <MaterialsPanel candidate={candidate} onPreview={onPreview} />
              </aside>
            </section>
          ) : (
            <TranscriptTab transcript={candidate.transcript} />
          )}
        </>
      ) : (
        <section className="processing-detail">
          <div className="overview-main">
          <article className="panel process-status-card">
            <h2>{WORKFLOW_LABELS[candidate.status]}</h2>
            {escalation ? (
              <>
                <p>
                  <b>{escalation.stage}:</b> {escalation.obstacle}
                </p>
                <p>{escalation.impact}</p>
                <p>
                  Автоматических попыток: {escalation.attempts}. Сохранено
                  артефактов: {escalation.reusableArtifacts.length}.
                </p>
                <div className="settings-actions">
                  {escalation.actions.map((action) => (
                    <button
                      className="primary-button"
                      disabled={resolving}
                      key={action.key}
                      onClick={() => void resolveEscalation(action.key)}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
                {resolutionError && <p role="alert">{resolutionError}</p>}
              </>
            ) : (
              <p>
                {candidate.status === "FAILED"
                  ? "Автоматическое продолжение невозможно; допустимое действие человека не определено."
                  : "Текущий запуск отображается как основной; прежние результаты недоступны."}
              </p>
            )}
            <p>
              {candidate.etaMinutes === null
                ? "Прогноз времени формируется"
                : `Осталось примерно ${candidate.etaMinutes} мин`}
            </p>
            <ProcessingTimeline candidate={candidate} />
          </article>
          <AssessmentProcessing />
          </div>
          <div className="processing-materials"><MaterialsPanel candidate={candidate} onPreview={onPreview} /></div>
        </section>
      )}
    </div>
  );
}

function AiOverviewDetails({
  overview,
}: {
  overview: NonNullable<NonNullable<UiCandidate["result"]>["aiOverview"]>;
}) {
  const [openCriterion, setOpenCriterion] = useState<string | null>(null);
  if (overview.state === "error") return <AssessmentUnavailable />;
  const evidence = Array.isArray(overview.evidence) ? overview.evidence : [];
  const renderedFactIds = new Set<string>();
  const linkedCriteria = <T extends { factIds?: string[] }>(items: T[], criterionName: (item: T) => string) => items.flatMap((criterion) => {
    const declaredFactIds = Array.isArray(criterion.factIds) ? criterion.factIds : [];
    const facts = evidence.filter((item) => !renderedFactIds.has(item.id)
      && (item.criterion === criterionName(criterion) || declaredFactIds.includes(item.id)));
    if (!facts.length) return [];
    facts.forEach((fact) => renderedFactIds.add(fact.id));
    return [{ criterion, facts, linkedFactCount: facts.length }];
  });
  const abcCriteria = linkedCriteria(Array.isArray(overview.abc) ? overview.abc : [], (criterion) => criterion.direction);
  const additionalCriteria = linkedCriteria(Array.isArray(overview.competencies) ? overview.competencies : [], (criterion) => criterion.name);
  const unmatchedCriteria = evidence.filter((item) => !renderedFactIds.has(item.id));
  const groupedAdditionalEvidence = Array.from(unmatchedCriteria.reduce((groups, fact) => {
    const rawCriterion = fact.criterion?.trim() || "Общий анализ";
    const criterion = /^[a-z][a-z0-9]*(?:[_.:-][a-z0-9]+)+$/i.test(rawCriterion) ? "Общий анализ" : rawCriterion;
    const current = groups.get(criterion) ?? [];
    current.push(fact);
    groups.set(criterion, current);
    return groups;
  }, new Map<string, CandidateEvidenceItem[]>()));
  return (
    <>
      <DecisionOutcomes overview={overview} />
      <article className="panel detailed-assessment-card candidate-assessment-region">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Критерии и факты</p>
            <h2>Детальная оценка</h2>
          </div>
        </div>
        <section className="assessment-subsection abc-criteria-subsection" aria-labelledby="abc-criteria-heading">
          <h3 id="abc-criteria-heading">ABC-критерии</h3>
        {abcCriteria.map(({ criterion, facts, linkedFactCount }, index) => {
          const rowKey = `abc:${criterion.direction}`;
          return <CriterionDisclosureRow
            key={rowKey}
            badge={criterion.grade}
            badgeClass={["A", "B", "C"].includes(criterion.grade) ? `grade-${criterion.grade.toLowerCase()}` : "grade-neutral"}
            title={criterion.direction}
            reason={criterion.reason ?? "Основание доступно в доказательствах"}
            facts={facts}
            factCount={linkedFactCount}
            evidenceId={`criterion-evidence-abc-${index}`}
            open={openCriterion === rowKey}
            onToggle={() => setOpenCriterion((current) => current === rowKey ? null : rowKey)}
          />
        })}
        </section>
        <section className="assessment-subsection additional-criteria-subsection" aria-labelledby="additional-criteria-heading">
          <h3 id="additional-criteria-heading">Дополнительные критерии</h3>
        {additionalCriteria.map(({ criterion: item, facts, linkedFactCount }, index) => {
          const rowKey = `competency:${item.name}:${index}`;
          return <CriterionDisclosureRow key={rowKey} rowClassName="competency-detail-row" badge="✓" badgeClass="grade-a" title={item.name} reason={item.reason} facts={facts} factCount={linkedFactCount} evidenceId={`criterion-evidence-additional-${index}`} open={openCriterion === rowKey} onToggle={() => setOpenCriterion((current) => current === rowKey ? null : rowKey)} />;
        })}
        {groupedAdditionalEvidence.map(([criterion, facts], index) => {
          const rowKey = `evidence:${criterion}`;
          return <CriterionDisclosureRow key={rowKey} rowClassName="grouped-evidence-detail-row" badge={<GroupedEvidenceIcon />} badgeClass="grade-neutral" title={criterion} reason="Доказательства, связанные с этим критерием" facts={facts} factCount={facts.length} evidenceId={`criterion-evidence-grouped-${index}`} open={openCriterion === rowKey} onToggle={() => setOpenCriterion((current) => current === rowKey ? null : rowKey)} />;
        })}
        </section>
      </article>
    </>
  );
}

function CriterionDisclosureRow({
  badge,
  badgeClass,
  title,
  reason,
  facts,
  factCount,
  evidenceId,
  open,
  onToggle,
  rowClassName = "",
}: {
  badge: ReactNode;
  badgeClass: string;
  title: string;
  reason?: string;
  facts: CandidateEvidenceItem[];
  factCount: number;
  evidenceId: string;
  open: boolean;
  onToggle: () => void;
  rowClassName?: string;
}) {
  return <div className={`criterion-detail-item criterion-detail-row ${rowClassName} ${open ? "is-open" : ""}`.trim()}>
    <button className="criterion-row-trigger" type="button" aria-expanded={open} aria-controls={evidenceId} onClick={onToggle}>
      <span className={`assessment-grade ${badgeClass}`}>{badge}</span>
      <span className="criterion-row-copy"><b>{title}</b>{reason && <span>{reason}</span>}<small>{formatEvidenceCount(factCount)}</small></span>
      <span className="criterion-row-chevron" aria-hidden="true">
        <svg className="criterion-row-chevron-icon" viewBox="0 0 16 16" focusable="false">
          <path d="M4 6L8 10L12 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
    <div className="criterion-evidence-area" id={evidenceId} aria-hidden={!open}>
      <div className="criterion-evidence-content">
        {facts.map((fact) => <div className="criterion-fact" key={fact.id}><b>{contextualEvidenceLabel(fact, title)}</b>{fact.claim && <p>{fact.claim}</p>}<small>{candidateEvidenceSource(fact)}</small>{fact.quote && <blockquote>«{fact.quote}»</blockquote>}</div>)}
      </div>
    </div>
  </div>;
}

function GroupedEvidenceIcon() {
  return <svg className="grouped-evidence-icon" viewBox="0 0 20 20" aria-hidden={true} data-icon="document-check" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5.5 2.75h5.75l3.25 3.25v11.25h-9zM11.25 2.75V6h3.25" />
    <polyline points="7.5 11 9.25 12.75 12.75 9.25" />
  </svg>;
}

function formatEvidenceCount(count: number) {
  const lastTwo = count % 100;
  const last = count % 10;
  const word = lastTwo >= 11 && lastTwo <= 14
    ? "доказательств"
    : last === 1
      ? "доказательство"
      : last >= 2 && last <= 4
        ? "доказательства"
        : "доказательств";
  return `${count} ${word}`;
}

function DecisionOutcomes({ overview }: { overview: NonNullable<NonNullable<UiCandidate["result"]>["aiOverview"]> }) {
  const sections = [["Сильные стороны", overview.strengths?.length ? overview.strengths : overview.competencies, "✓"], ["Риски и пробелы", overview.risks, "!"], ["Стоп-факторы", overview.stopFactors, "!"], ["Компетенции", overview.competencies, "✓"]] as const;
  return <div className="decision-outcomes-grid">{sections.map(([title, sourceItems, icon]) => {
    const items = Array.isArray(sourceItems) ? sourceItems : [];
    const renderItem = (item: (typeof items)[number], index: number) => <div className="decision-outcome-item" key={`${item.name}-${index}`}><span className="decision-outcome-icon">{icon}</span><p><b>{item.name}</b>{item.reason && <small>{item.reason}</small>}</p></div>;
    return <article className={`panel decision-outcome-card ${icon === "!" ? "is-risk" : "is-strength"}`} key={title}><header><span className="decision-outcome-icon">{icon}</span><h2>{title}</h2></header>{items.length ? items.map(renderItem) : <p className="assessment-empty" data-state="none-found">Не выявлено</p>}</article>;
  })}</div>;
}

function keAccessState(state?: string) {
  const normalized = state?.trim() ?? "";
  if (/^(?:не\s+(?:подтверж|допущ)|нет\b)/i.test(normalized)) return { className: "ke-state-not-confirmed", icon: "×" };
  if (/частич/i.test(normalized)) return { className: "ke-state-partial", icon: "◐" };
  if (/требует|уточн|недостаточно|ожида/i.test(normalized)) return { className: "ke-state-needs-clarification", icon: "?" };
  if (/подтверж|допущ|^да\b/i.test(normalized)) return { className: "ke-state-confirmed", icon: "✓" };
  return { className: "ke-state-needs-clarification", icon: "?" };
}

function AssessmentAside({ overview }: { overview: NonNullable<NonNullable<UiCandidate["result"]>["aiOverview"]> }) {
  if (overview.state === "error") return <AssessmentUnavailable />;
  const abc = Array.isArray(overview.abc) ? overview.abc : [];
  const accessToKe = Array.isArray(overview.accessToKe) ? overview.accessToKe : [];
  const matchPercent = calculateAbcMatchPercent(abc);
  return <>
    <article className="panel assessment-score-card candidate-matching-score-region"><div className="matching-score-heading" role={matchPercent === null ? undefined : "meter"} aria-label={matchPercent === null ? "Оценка ещё не готова" : `Расчётный индекс ABC: ${matchPercent}%`} aria-valuenow={matchPercent ?? undefined} aria-valuemin={matchPercent === null ? undefined : 0} aria-valuemax={matchPercent === null ? undefined : 100}><div><h2 className="matching-region-heading">Оценка соответствия</h2><h3>ABC-профиль</h3></div><strong>{matchPercent === null ? "—" : `${matchPercent}%`}</strong></div>
      {matchPercent === null && <p className="assessment-empty">Оценка ещё не готова</p>}
      <div className="assessment-score-list">{abc.map((item) => { const percent = abcGradePercent(item.grade); return <div key={item.direction}><span className={`assessment-grade ${percent === null ? "grade-neutral" : `grade-${item.grade.toLowerCase()}`}`}>{percent === null ? "—" : item.grade}</span><p><b>{item.direction}</b><i role={percent === null ? undefined : "meter"} aria-label={percent === null ? `${item.direction}: оценка ещё не готова` : `${item.direction}: ${percent}% по индексу ABC`} aria-valuenow={percent ?? undefined} aria-valuemin={percent === null ? undefined : 0} aria-valuemax={percent === null ? undefined : 100} className="grade-bar"><em style={{ width: percent === null ? "0" : `${percent}%` }} /></i></p><strong>{percent === null ? "—" : `${percent}%`}</strong></div>; })}</div>
    </article>
    <section className="panel ke-access-card candidate-ke-region">
      <article className="ke-access-content">
        <h2 className="eyebrow">Допуск к КЕ</h2><h3>{overview.accessToKe.length ? `${overview.accessToKe.filter((item) => keAccessState(item.state).className === "ke-state-confirmed").length} из ${overview.accessToKe.length} условий` : "Условия не заданы"}</h3>
        <div>{accessToKe.length ? accessToKe.map((item, index) => { const state = keAccessState(item.state); return <p className={state.className} key={`${item.name}-${index}`}><span>{state.icon}</span><b>{item.name}</b><small>{item.state ?? "Требует уточнения"}</small>{item.reason ? <em>{item.reason}</em> : null}</p>; }) : <p className="assessment-empty" data-state="none-found">Условия КЕ не заданы в профиле вакансии.</p>}</div>
      </article>
    </section>
  </>;
}

const EVIDENCE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  personal_contribution_event_case: "Личный вклад",
  result_event_case: "Подтверждённый результат",
  resume_achievement_fact: "Результат из резюме",
  competency_evidence: "Подтверждение компетенции",
  risk_evidence: "Основание риска",
});

function candidateEvidenceLabel(item: CandidateEvidenceItem) {
  const key = item.technicalType?.trim() || item.label?.trim();
  if (key && EVIDENCE_LABELS[key]) return EVIDENCE_LABELS[key];
  if (key?.startsWith("competency:")) return "Подтверждение компетенции";
  if (key?.startsWith("abc:")) return "Основание ABC-оценки";
  if (key && !/^[a-z][a-z0-9]*(?:[_.:-][a-z0-9]+)+$/i.test(key)) return key;
  return "Доказательство";
}

function contextualEvidenceLabel(item: CandidateEvidenceItem, criterion: string) {
  const label = candidateEvidenceLabel(item);
  return label === "Доказательство" ? `Доказательство · ${criterion}` : label;
}

function candidateEvidenceSource(item: CandidateEvidenceItem) {
  const locator = item.timecode
    ? item.timecode
    : typeof item.page === "number" && item.page > 0
      ? `стр. ${item.page}`
      : "";
  const source = item.source?.replace(/\s*·\s*Раздел не определён/gi, "").trim() ?? "";
  const normalizedSource = source.toLocaleLowerCase("ru");
  const pageAlreadyPresent = typeof item.page === "number" && new RegExp(`(?:страница|стр\\.)\\s*${item.page}(?:\\D|$)`, "i").test(normalizedSource);
  return [source, locator && !pageAlreadyPresent && !normalizedSource.includes(locator.toLocaleLowerCase("ru")) ? locator : ""].filter(Boolean).join(" · ");
}

function genericDecisionText(value: string | undefined) {
  return !value?.trim() || /отч[её]т(?:ы)? (?:успешно )?(?:готов|сформирован|опубликован)|анализ заверш[её]н|результат готов|кандидат соответствует требованиям\.?$/i.test(value.trim());
}

function candidateDecisionSummary(candidate: UiCandidate) {
  const overview = candidate.result?.aiOverview;
  if (!genericDecisionText(candidate.result?.summary)) return candidate.result!.summary;
  if (!genericDecisionText(overview?.summary)) return overview!.summary!;
  return overview?.competencies.find((item) => item.reason)?.reason
    ?? overview?.abc.find((item) => item.reason)?.reason
    ?? "Предметная выжимка отсутствует в актуальной версии оценки.";
}

function candidateRecommendationBasis(overview: NonNullable<NonNullable<UiCandidate["result"]>["aiOverview"]>) {
  if (!genericDecisionText(overview.recommendationBasis)) return overview.recommendationBasis;
  return (overview.stopFactors ?? []).find((item) => item.reason)?.reason
    ?? (overview.risks ?? []).find((item) => item.reason)?.reason
    ?? (overview.abc ?? []).find((item) => item.reason)?.reason
    ?? "Предметное основание рекомендации отсутствует в актуальной версии оценки.";
}

function AssessmentUnavailable() {
  const headings = ["ABC-профиль", "Стоп-факторы", "Компетенции", "Риски и пробелы", "Допуск к КЕ", "Ключевые доказательства"];
  return <div className="assessment-state-grid" data-state="error">{headings.map((heading) => <article className="panel assessment-state-card" key={heading}><h2>{heading}</h2><p>Данные раздела временно недоступны.</p></article>)}</div>;
}

function AssessmentProcessing() {
  const headings = ["ABC-профиль", "Стоп-факторы", "Компетенции", "Риски и пробелы", "Допуск к КЕ", "Ключевые доказательства"];
  return <div className="assessment-state-grid" data-state="processing">{headings.map((heading) => <article className="panel assessment-state-card" key={heading}><h2>{heading}</h2><p>Анализ выполняется — данные раздела формируются.</p></article>)}</div>;
}

function ProcessingTimeline({ candidate }: { candidate: UiCandidate }) {
  const stages = [
    { label: "Обнаружен", statuses: ["NEW", "WAITING_FOR_STABILITY"] },
    { label: "Проверка файлов", statuses: ["MATERIALS_INCOMPLETE", "MATERIALS_READY"] },
    { label: "Транскрибация", statuses: ["TRANSCRIBING"] },
    { label: "AI-анализ", statuses: ["ANALYZING"] },
    { label: "Проверка результата", statuses: ["VALIDATING", "WAITING_FOR_HUMAN", "FAILED"] },
    { label: "Готово", statuses: ["READY"] },
  ] as const;
  const found = stages.findIndex((stage) => (stage.statuses as readonly string[]).includes(candidate.status));
  const current = found < 0 ? 0 : found;
  const progress = Number.isFinite(candidate.progressPercent) ? Math.min(100, Math.max(0, Math.round(candidate.progressPercent!))) : null;
  const elapsedMinutes = displayedElapsedMinutes(candidate);
  return <>
    <div className="stage-list processing-timeline" aria-label="Ход обработки">{stages.map((stage, index) => <div className={index < current ? "done" : index === current ? "active" : ""} key={stage.label}><i>{index < current ? "✓" : index + 1}</i><b>{stage.label}</b><small>{index < current ? "Завершено" : index === current ? (candidate.progressMilestone?.trim() || WORKFLOW_LABELS[candidate.status]) : "Ожидает"}</small></div>)}</div>
    <div className="processing-stat-grid processing-metrics" aria-label="Показатели обработки"><span><small>Прошло</small><b>{elapsedMinutes} мин</b></span><span><small>Осталось</small><b>{candidate.etaMinutes === null ? "Прогноз формируется" : `≈ ${candidate.etaMinutes} мин`}</b></span><span><small>Прогресс</small><b>{progress === null ? "—" : `${progress}%`}</b></span><span><small>Текущий этап</small><b>{candidate.progressMilestone?.trim() || WORKFLOW_LABELS[candidate.status]}</b></span></div>
  </>;
}

function MaterialsPanel({
  candidate,
  onPreview,
}: {
  candidate: UiCandidate;
  onPreview: (preview: Preview) => void;
}) {
  const materialIcon = { resume: "▧", interview: "▶", notes: "▤", document: "▤", other: "•" } as const;
  const materialKind = { resume: "PDF · обработано", interview: candidate.status === "TRANSCRIBING" ? "Транскрибируется" : "Видео", notes: "Документ", document: "Документ", other: "Материал" } as const;
  const materials = candidate.materials ?? [];
  const pairReady = validateResultPair(candidate);
  return (
    <article className="panel sources-panel materials-compact candidate-materials-region">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Google Drive</p>
          <h2>Материалы</h2>
        </div>
      </div>
      {materials.map((file) => (
        <div key={file.id}>
          <span>{materialIcon[file.kind]}</span>
          <p>
            <b>{file.fileName}</b>
            <small>{file.state ?? materialKind[file.kind]}</small>
          </p>
        </div>
      ))}
      {!materials.length && <p className="materials-empty" data-state="none-found">Материалы не найдены.</p>}
      {pairReady && (
        <div className="result-materials">
          <p className="result-materials-header">
            <b>Результаты</b>
            <small>
              Актуальная версия v
              {String(candidate.result!.version).padStart(4, "0")}
            </small>
          </p>
          <div className="result-materials-actions">
            <button
              onClick={() =>
                onPreview({
                  candidateId: candidate.id,
                  type: "candidate-results",
                  version: candidate.result!.version,
                  title: "Итоги",
                })
              }
            >
              Итоги
            </button>
            <button
              onClick={() =>
                onPreview({
                  candidateId: candidate.id,
                  type: "abc-test",
                  version: candidate.result!.version,
                  title: "ABC-тест",
                })
              }
            >
              ABC-тест
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function PdfPreview({
  preview,
  onClose,
}: {
  preview: NonNullable<Preview>;
  onClose: () => void;
}) {
  const url = `/api/results?candidate=${preview.candidateId}&type=${preview.type}&version=${preview.version}`;
  const invalid = !preview.candidateId || !preview.version;
  const [state, setState] = useState<"loading" | "ready" | "error">(
    invalid ? "error" : "loading",
  );
  const [objectUrl, setObjectUrl] = useState("");
  useEffect(() => {
    if (invalid) return;
    const controller = new AbortController();
    let allocated = "";
    void fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (
          !response.ok ||
          response.headers.get("content-type")?.split(";", 1)[0] !==
            "application/pdf"
        )
          throw new Error("PDF unavailable");
        allocated = URL.createObjectURL(await response.blob());
        setObjectUrl(allocated);
        setState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("error");
      });
    return () => {
      controller.abort();
      if (allocated) URL.revokeObjectURL(allocated);
    };
  }, [invalid, url]);
  return (
    <div className="modal-backdrop">
      <section
        className="pdf-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Просмотр документа ${preview.title}`}
      >
        <header>
          <div>
            <p className="eyebrow">
              Read-only · v{String(preview.version).padStart(4, "0")}
            </p>
            <h2>{preview.title}</h2>
          </div>
          <div>
            {state !== "error" && (
              <a className="secondary-button" href={`${url}&download=1`}>
                Скачать {preview.title}
              </a>
            )}
            <button onClick={onClose} aria-label="Закрыть">
              ×
            </button>
          </div>
        </header>
        {state === "error" ? (
          <div className="preview-error" role="alert">
            Документ временно недоступен.{" "}
            <button onClick={onClose}>Закрыть</button>
          </div>
        ) : (
          <div className="preview-frame">
            {state === "loading" && (
              <div className="preview-loading" role="status">
                Загружаем проверенный PDF…
              </div>
            )}
            <iframe
              title={preview.title}
              src={state === "ready" ? objectUrl : url}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function transcriptTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function transcriptSpeaker(value: string) {
  const speaker = value.trim();
  return /^спикер\b/i.test(speaker) ? speaker : `Спикер ${speaker}`;
}

function TranscriptTab({ transcript }: { transcript?: CandidateTranscript }) {
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLocaleLowerCase("ru-RU");
  const rows = (transcript?.utterances ?? []).filter((row) =>
    `${row.speaker} ${row.text}`.toLocaleLowerCase("ru-RU").includes(normalizedSearch),
  );
  return (
    <section className="tab-panel panel transcript candidate-transcript-region" aria-labelledby="candidate-transcript-title">
      <div className="panel-head">
        <div>
          <h2 id="candidate-transcript-title">Транскрипция</h2>
          {!!transcript?.utterances.length && <small className="transcript-total">{transcript.utterances.length} реплик</small>}
        </div>
        <label className="transcript-search">
          ⌕{" "}
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск по тексту"
          />
        </label>
      </div>
      {!rows.length ? (
        <p className="transcript-empty-state">
          {normalizedSearch ? "По запросу ничего не найдено." : "Транскрипция для опубликованной версии отсутствует."}
        </p>
      ) : rows.map((row, index) => (
        <article className="transcript-utterance" key={`${row.startMs}-${row.endMs}-${index}`}>
          <time dateTime={`PT${Math.floor(row.startMs / 1000)}S`}>{transcriptTime(row.startMs)}</time>
          <b>{transcriptSpeaker(row.speaker)}</b>
          <p>{row.text}</p>
        </article>
      ))}
    </section>
  );
}
