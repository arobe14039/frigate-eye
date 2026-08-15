/**
 * Home Assistant access via the Supervisor proxy. SUPERVISOR_TOKEN never
 * leaves this process and is never sent to the frontend.
 */
const SUPERVISOR_TOKEN = process.env["SUPERVISOR_TOKEN"] ?? "";
const CORE_API = "http://supervisor/core/api";

const authHeaders = () => ({
  authorization: `Bearer ${SUPERVISOR_TOKEN}`,
  "content-type": "application/json",
});

export const haAvailable = () => Boolean(SUPERVISOR_TOKEN);

async function coreFetch<T>(path: string): Promise<T | null> {
  if (!haAvailable()) return null;
  try {
    const res = await fetch(`${CORE_API}${path}`, { headers: authHeaders() });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const haStatus = async () => {
  const config = await coreFetch<any>("/config");
  return {
    available: haAvailable(),
    connected: Boolean(config),
    version: config?.version as string | undefined,
    locationName: config?.location_name as string | undefined,
    timeZone: config?.time_zone as string | undefined,
  };
};

/**
 * Identity for per-user preferences. Only Ingress-supplied identity is trusted:
 * Supervisor sets `X-Remote-User-Id` on proxied requests. Any other
 * browser-provided header is ignored, and without Supervisor we fall back to a
 * single shared local profile.
 */
export function resolveUserId(headers: Record<string, unknown>): string {
  if (!haAvailable()) return "local";
  const id = headers["x-remote-user-id"];
  if (typeof id === "string" && /^[a-zA-Z0-9_-]{6,64}$/.test(id)) return id;
  return "local";
}

export function resolveUserName(headers: Record<string, unknown>): string | null {
  if (!haAvailable()) return null;
  const name = headers["x-remote-user-display-name"];
  return typeof name === "string" && name.length < 64 ? name : null;
}
