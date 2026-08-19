export class E2eControlClient {
  constructor(config) {
    this.config = config;
  }

  async request(path, { method = "GET", body } = {}) {
    const response = await fetch(`${this.config.controlUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.config.controlToken}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`E2E control ${method} ${path} failed with HTTP ${response.status}`);
    return payload;
  }

  async waitFor(runId, predicate, timeoutMs = 30 * 60 * 1_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const state = await this.request(`/runs/${encodeURIComponent(runId)}`);
      if (predicate(state)) return state;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    throw new Error(`E2E run ${runId} did not reach the required observable state before timeout`);
  }
}
