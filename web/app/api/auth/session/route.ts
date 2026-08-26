import { requestAuthPrincipal } from "../../../../server/auth/request-principal.ts";
const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
export async function GET(request: Request) {
  const principal = await requestAuthPrincipal(request);
  if (!principal) return Response.json({ authenticated: false }, { status: 401, headers });
  return Response.json({ authenticated: true, user: { id: principal.id, email: principal.email, displayName: principal.displayName, role: principal.role }, scope: principal.scope }, { headers });
}
