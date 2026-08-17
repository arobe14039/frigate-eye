/**
 * Home Assistant access via the Supervisor proxy. SUPERVISOR_TOKEN never
 * leaves this process, is never logged, and is never sent to the frontend.
 *
 * User identity is NOT resolved here: identity headers are only meaningful for
 * a request proven to have arrived through Ingress, which is decided in
 * `security/ingress.ts`.
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
