export const syntheticAuthFixture = Object.freeze({
  scenarioId: "AUTH-LOGIN-RED-001",
  clock: "2026-08-21T08:00:00.000Z",
  origin: "https://hr.synthetic.example",
  loopbackOrigin: "http://127.0.0.1:3000",
  user: {
    id: "hr-synthetic-001",
    emailInput: "  ALSU.SYNTHETIC@Example.Test ",
    canonicalEmail: "alsu.synthetic@example.test",
    displayName: "Алсу Синтетическая",
    role: "HR-владелец вакансии",
    temporaryPassword: "Synthetic-Only-Password-42",
  },
  attacker: {
    identityHeaders: {
      "oai-authenticated-user-id": "forged-hr",
      "oai-authenticated-user-email": "forged@example.test",
    },
    source: "synthetic-source-a",
  },
  safeReturnPath: "/vacancies",
  unsafeReturnPaths: [
    "https://attacker.example/collect",
    "//attacker.example/collect",
    "javascript:alert(1)",
  ],
  productRequests: [
    "/api/workspace",
    "/api/dashboard?period=7",
    "/api/vacancies",
    "/api/candidates/lifecycle",
    "/api/results?candidate=synthetic&type=abc-test&version=1",
    "/api/integrations/google-drive/oauth/status",
  ],
  mutation: {
    method: "POST",
    path: "/api/vacancies",
    body: { title: "Синтетическая вакансия" },
  },
  evidencePolicy: {
    synthetic: true,
    containsRealPersonalData: false,
    containsCredentials: false,
    containsSessionTokens: false,
    containsCsrfSecrets: false,
    containsPlaintextSourceIdentifiers: false,
  },
});

export const syntheticLoginUiFixture = Object.freeze({
  scenarioId: "AUTH-LOGIN-UI-RED-001",
  initialTheme: "dark",
  viewportNames: ["desktop", "tablet", "mobile"],
  syntheticComposition: {
    candidateName: "Мария Синтетическая",
    vacancy: "Руководитель направления",
    stages: ["Материалы", "Транскрибация", "AI-анализ", "Готово"],
    result: "Рекомендовать с оговорками",
  },
  forbiddenProductRequests: [
    "/api/workspace",
    "/api/dashboard",
    "/api/vacancies",
    "/api/candidates",
    "/api/results",
    "/api/integrations/google-drive",
  ],
});
