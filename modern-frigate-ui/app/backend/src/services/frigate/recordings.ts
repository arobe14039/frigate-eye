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

/**
 * Snap a requested instant onto recorded video.
 *
 * Frigate answers a VOD request for a gap with an empty playlist, so the
 * playhead is moved to the nearest recorded moment (inside the segment when the
 * instant is covered, otherwise the closest segment edge within the window).
 */
export async function snapToRecording(camera: string, atMs: number, windowMs = 30 * 60_000) {
  const segments = await listRecordings(camera, atMs - windowMs, atMs + windowMs).catch(
    () => [] as RecordingSegment[],
  );
  if (!segments.length) return { time: atMs, available: false, segment: null };

  const covering = segments.find((s) => atMs >= s.startTime && atMs <= s.endTime);
  if (covering) return { time: atMs, available: true, segment: covering };

  const nearest = segments.reduce((best, segment) => {
    const distance = Math.min(
      Math.abs(segment.startTime - atMs),
      Math.abs(segment.endTime - atMs),
    );
    const bestDistance = Math.min(
      Math.abs(best.startTime - atMs),
      Math.abs(best.endTime - atMs),
    );
    return distance < bestDistance ? segment : best;
  }, segments[0]!);

  const time = atMs < nearest.startTime ? nearest.startTime : nearest.endTime - 1_000;
  return { time, available: true, segment: nearest };
}
