import { frigateJson } from "./client.js";
import { listEvents } from "./events.js";
import type { RecordingSegment } from "./types.js";

/** Frigate: GET /api/<camera>/recordings/summary and /api/<camera>/recordings */
export async function listRecordings(
  camera: string,
  after: number,
  before: number,
): Promise<RecordingSegment[]> {
  const params = new URLSearchParams({
    after: String(Math.floor(after / 1000)),
    before: String(Math.floor(before / 1000)),
  });
  const raw = await frigateJson<any[]>(
    `/api/${encodeURIComponent(camera)}/recordings?${params.toString()}`,
  );
  return raw.map((segment) => ({
    camera,
    startTime: Number(segment.start_time) * 1000,
    endTime: Number(segment.end_time) * 1000,
    available: true,
    motion: segment.motion ?? undefined,
    objects: segment.objects ?? undefined,
  }));
}

/** Timeline payload: recording availability + detections in one round trip. */
export async function getTimeline(camera: string, after: number, before: number) {
  const [segments, events] = await Promise.all([
    listRecordings(camera, after, before).catch(() => [] as RecordingSegment[]),
    listEvents({ cameras: [camera], after, before, limit: 100 }).catch(() => []),
  ]);
  return { camera, after, before, segments, events };
}
