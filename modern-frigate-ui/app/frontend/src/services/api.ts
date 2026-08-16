import { demo, demoImageFor } from "./demoData";
import type {
  AppStatus,
  Diagnostics,
  Camera,
  CameraDetail,
  DetectionEvent,
  PlaybackWindow,
  Preferences,
  TimelineData,
} from "../types";

/**
 * Ingress-safe URL builder.
 *
 * Home Assistant serves this app from a dynamic prefix such as
 * `/api/hassio_ingress/<token>/`, so every request, asset and stream URL is
 * resolved against the document base instead of the site root.
 */
function appBase(): string {
  const href = document.baseURI || window.location.href;
  return href.endsWith("/") ? href : href.replace(/[^/]*$/, "");
}

export const apiUrl = (path: string) => new URL(path.replace(/^\/+/, ""), appBase()).toString();

export const socketUrl = (path: string) => {
  const url = new URL(path.replace(/^\/+/, ""), appBase());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

/**
 * Backend reachability is probed once. Until it answers, media URLs resolve to
 * bundled demo frames so the UI never fires requests we know will fail (the
 * design preview has no add-on backend behind it).
 */
let backendUp: boolean | null = null;
let probe: Promise<boolean> | null = null;
let demoMode = false;

/**
 * True when real media cannot be served: either no backend at all, or the
 * backend is up but Frigate is unreachable (then API calls already fell back
 * to demo data, so demo frames must be used as well).
 */
const useDemoMedia = () => backendUp !== true || demoMode;

const probeBackend = () => {
  probe ??= fetch(apiUrl("api/status"), { headers: { accept: "application/json" } })
    .then((response) => response.ok && response.headers.get("content-type")?.includes("json") === true)
    .catch(() => false)
    .then((ok) => {
      backendUp = ok;
      demoMode = !ok;
      return ok;
    });
  return probe;
};

/** Media URLs always point at our own backend, never at Frigate. */
export const cameraPreviewUrl = (cameraId: string, height = 360, bust?: number) =>
  useDemoMedia()
    ? demoImageFor(cameraId)
    : apiUrl(`api/cameras/${encodeURIComponent(cameraId)}/preview?h=${height}${bust ? `&t=${bust}` : ""}`);

export const eventThumbnailUrl = (eventId: string, camera?: string) =>
  useDemoMedia()
    ? demoImageFor(camera ?? "")
    : apiUrl(`api/events/${encodeURIComponent(eventId)}/thumbnail`);

export const eventSnapshotUrl = (eventId: string, camera?: string) =>
  useDemoMedia()
    ? demoImageFor(camera ?? "")
    : apiUrl(`api/events/${encodeURIComponent(eventId)}/snapshot`);

export const recordingFrameUrl = (cameraId: string, timestamp: number) =>
  useDemoMedia()
    ? demoImageFor(cameraId)
    : apiUrl(`api/recordings/${encodeURIComponent(cameraId)}/frame/${Math.floor(timestamp)}`);

/** Recorded playback URLs — Frigate VOD, proxied by our backend. */
export const vodPlaylistUrl = (playlist: string) => apiUrl(playlist);

export const eventVodUrl = (eventId: string) =>
  apiUrl(`api/playback/event/${encodeURIComponent(eventId)}/vod/index.m3u8`);

export const eventClipUrl = (eventId: string) =>
  apiUrl(`api/playback/event/${encodeURIComponent(eventId)}/clip.mp4`);

export const isDemoMode = () => demoMode;

/** Resolves false when no add-on backend is behind this page. */
export const backendReachable = () => probeBackend();

async function getJson<T>(path: string, fallback: () => T): Promise<T> {
  // Never issue the real request when the probe already told us there is no
  // backend: that would produce a stream of failed requests per screen.
  if (!(await probeBackend())) {
    demoMode = true;
    return fallback();
  }
  try {
    const response = await fetch(apiUrl(path), { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(String(response.status));
    demoMode = false;
    backendUp = true;
    return (await response.json()) as T;
  } catch {
    // No backend reachable (design preview, or add-on still starting):
    // fall back to demo data so the interface stays explorable.
    demoMode = true;
    return fallback();
  }
}

export const api = {
  status: () => getJson<AppStatus>("api/status", demo.status),
  testConnection: async () => {
    probe = null;
    if (!(await probeBackend())) return { connected: false, error: "Backend unreachable" };
    try {
      const response = await fetch(apiUrl("api/status/test"), {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: "{}",
      });
      return (await response.json()) as { connected: boolean; error?: string };
    } catch {
      return { connected: false, error: "Backend unreachable" };
    }
  },
  diagnostics: () => getJson<Diagnostics>("api/diagnostics", demo.diagnostics),
  cameras: () => getJson<Camera[]>("api/cameras", demo.cameras),
  camera: (id: string) =>
    getJson<CameraDetail>(`api/cameras/${encodeURIComponent(id)}`, () => demo.camera(id)),
  labels: () => getJson<string[]>("api/labels", demo.labels),
  events: (params: {
    cameras?: string[];
    labels?: string[];
    zones?: string[];
    limit?: number;
    before?: number;
  }) => {
    const search = new URLSearchParams();
    if (params.cameras?.length) search.set("cameras", params.cameras.join(","));
    if (params.labels?.length) search.set("labels", params.labels.join(","));
    if (params.zones?.length) search.set("zones", params.zones.join(","));
    if (params.before) search.set("before", String(params.before));
    search.set("limit", String(params.limit ?? 25));
    return getJson<DetectionEvent[]>(`api/events?${search.toString()}`, () => demo.events(params));
  },
  playbackWindow: (camera: string, at: number, windowMs = 300_000) =>
    getJson<PlaybackWindow>(
      `api/playback/${encodeURIComponent(camera)}/window?at=${Math.floor(at)}&window=${Math.floor(windowMs)}`,
      () => ({
        camera,
        available: false,
        time: at,
        start: at,
        end: at + windowMs,
        playlist: "",
      }),
    ),
  timeline: (camera: string, after: number, before: number) =>
    getJson<TimelineData>(
      `api/timeline/${encodeURIComponent(camera)}?after=${Math.floor(after)}&before=${Math.floor(before)}`,
      () => demo.timeline(camera, after, before),
    ),
  session: () =>
    getJson<{ userName: string | null; preferences: Preferences }>("api/session", demo.session),
  savePreferences: async (patch: Partial<Preferences>) => {
    try {
      const response = await fetch(apiUrl("api/preferences"), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error("failed");
      return (await response.json()) as Preferences;
    } catch {
      return null;
    }
  },
  exportClip: async (camera: string, start: number, end: number) => {
    try {
      const response = await fetch(apiUrl("api/exports"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ camera, start, end }),
      });
      return response.ok;
    } catch {
      return false;
    }
  },
};
