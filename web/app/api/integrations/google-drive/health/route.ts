const PRIVATE_HEADERS = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  if (!request.headers.get("oai-authenticated-user-id")) {
    return Response.json({ state: "disconnected" }, { status: 401, headers: PRIVATE_HEADERS });
  }

  try {
    const { env } = await import("cloudflare:workers");
    const endpoint = env.GOOGLE_DRIVE_HEALTHCHECK_URL?.trim();
    if (!endpoint) throw new Error("Drive health endpoint is unavailable");
    const token = env.GOOGLE_DRIVE_HEALTHCHECK_TOKEN?.trim();
    const response = await fetch(endpoint, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("integration health probe failed");
    return Response.json({ state: "connected" }, { headers: PRIVATE_HEADERS });
  } catch {
    return Response.json({ state: "disconnected" }, { status: 503, headers: PRIVATE_HEADERS });
  }
}
