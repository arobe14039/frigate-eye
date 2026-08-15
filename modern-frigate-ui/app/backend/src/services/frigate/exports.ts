import { frigateFetch, frigateJson } from "./client.js";

/** Frigate: POST /api/export/<camera>/start/<start>/end/<end> */
export async function requestExport(camera: string, startMs: number, endMs: number, name?: string) {
  const res = await frigateFetch(
    `/api/export/${encodeURIComponent(camera)}/start/${Math.floor(startMs / 1000)}/end/${Math.floor(endMs / 1000)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playback: "realtime", name: name ?? `${camera}-${startMs}` }),
    },
    15_000,
  );
  return (await res.json()) as unknown;
}

export const listExports = () => frigateJson<any[]>("/api/exports");
