import { frigateJson } from "./client.js";
import type { DetectionEvent } from "./types.js";

export interface EventQuery {
  cameras?: string[];
  labels?: string[];
  zones?: string[];
  after?: number;
  before?: number;
  limit?: number;
}

const toEvent = (raw: any): DetectionEvent => ({
  id: String(raw.id),
  camera: raw.camera,
  label: raw.label,
  subLabel: raw.sub_label ?? undefined,
  startTime: Number(raw.start_time) * 1000,
  endTime: raw.end_time ? Number(raw.end_time) * 1000 : undefined,
  score: raw.data?.top_score ?? raw.top_score ?? raw.score ?? undefined,
  zones: raw.zones ?? [],
  hasSnapshot: Boolean(raw.has_snapshot),
  hasClip: Boolean(raw.has_clip),
  // Media always points back at OUR api — never at Frigate.
  thumbnailUrl: `api/events/${raw.id}/thumbnail`,
  snapshotUrl: raw.has_snapshot ? `api/events/${raw.id}/snapshot` : undefined,
});

/** GET /api/events on Frigate. */
export async function listEvents(query: EventQuery = {}): Promise<DetectionEvent[]> {
  const params = new URLSearchParams();
  params.set("limit", String(Math.min(query.limit ?? 25, 100)));
  params.set("include_thumbnails", "0");
  if (query.cameras?.length) params.set("cameras", query.cameras.join(","));
  if (query.labels?.length) params.set("labels", query.labels.join(","));
  if (query.zones?.length) params.set("zones", query.zones.join(","));
  if (query.after) params.set("after", String(Math.floor(query.after / 1000)));
  if (query.before) params.set("before", String(Math.floor(query.before / 1000)));

  const raw = await frigateJson<any[]>(`/api/events?${params.toString()}`);
  return raw.map(toEvent);
}

export async function getEvent(id: string): Promise<DetectionEvent | null> {
  try {
    return toEvent(await frigateJson<any>(`/api/events/${encodeURIComponent(id)}`));
  } catch {
    return null;
  }
}
