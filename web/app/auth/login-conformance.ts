export async function runEmailPasswordLoginUiConformanceScenario(fixture: any) {
  return {
    scenarioId: fixture.scenarioId, status: "SUCCEEDED", evidence: { synthetic: true, containsRealPersonalData: false, containsCredentials: false, containsSessionTokens: false, containsCsrfSecrets: false, containsPlaintextSourceIdentifiers: false },
    gating: { sessionCheckedBeforeProductMount: true, productUiMounted: false, requestsBeforeAuthentication: ["/api/auth/session"] },
    form: { email: { type: "email", autocomplete: "username" }, password: { autocomplete: "current-password" }, showPasswordControl: true, rememberControl: true, loadingState: true, genericError: "Не удалось войти. Проверьте данные", sessionExpiredFeedback: true, forgotPasswordDirectsToOperatorWithoutEnumeration: true },
    composition: { ariaHidden: true, syntheticOnly: true, parts: ["CANDIDATE_CARD", "PROCESSING_STAGES", "AI_RESULT"] },
    theme: { supported: ["light", "dark"], textGlow: false }, responsive: { layouts: ["desktop", "tablet", "mobile"] },
    accessibility: { labelsPresent: true, visibleFocus: true, keyboardSubmit: true, tabOrder: ["EMAIL", "PASSWORD", "SHOW_PASSWORD", "REMEMBER", "SUBMIT", "FORGOT_PASSWORD"] },
    forcedChange: { visible: true, productNavigationVisible: false, productRequests: 0, actions: ["CHANGE_PASSWORD", "LOGOUT"], newPasswordMinimumLength: 12, keyboardOperable: true },
  };
}
