const HEADERS = { "cache-control": "no-store" };

export async function GET() {
  return Response.json({ live: true, runtime: "node" }, { headers: HEADERS });
}
