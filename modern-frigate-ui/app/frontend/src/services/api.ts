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
 * Demo fixtures are a DEVELOPMENT tool only.
 *
 * This is a security camera interface: a Frigate or camera outage must never
 * be papered over with fictional cameras, events or imagery. Demo data is used
 * only when the build was explicitly created with `VITE_DEMO_MODE=true`, which
 * never happens for the add-on image. In production a failure surfaces as a
 * failure.
 */
export const DEMO_MODE: boolean =
  (import.meta.env["VITE_DEMO_MODE"] ?? "") === "true" ||
  (import.meta.env["VITE_FRIGATE_MOCK"] ?? "") === "true";

export const isDemoMode = () => DEMO_MODE;

/** Thrown for any failed backend call so the UI can show a truthful state. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
  /** No backend at all (add-on starting, or a design preview with no server). */
  get backendUnreachable() {
    return this.status === 0;
  }
  get frigateUnavailable() {
    return this.status === 503;
  }
}

/** Media URLs always point at our own backend, never at Frigate. */
export const cameraPreviewUrl = (cameraId: string, height = 360, bust?: number) =>
  DEMO_MODE
    ? demoImageFor(cameraId)
    : apiUrl(`api/cameras/${encodeURIComponent(cameraId)}/preview?h=${height}${bust ? `&t=${bust}` : ""}`);

export const eventThumbnailUrl = (eventId: string, camera?: string) =>
  DEMO_MODE ? demoImageFor(camera ?? "") : apiUrl(`api/events/${encodeURIComponent(eventId)}/thumbnail`);

export const eventSnapshotUrl = (eventId: string, camera?: string) =>
  DEMO_MODE ? demoImageFor(camera ?? "") : apiUrl(`api/events/${encodeURIComponent(eventId)}/snapshot`);

export const recordingFrameUrl = (cameraId: string, timestamp: number) =>
  DEMO_MODE
    ? demoImageFor(cameraId)
    : apiUrl(`api/recordings/${encodeURIComponent(cameraId)}/frame/${Math.floor(timestamp)}`);

/** Recorded playback URLs — Frigate VOD, proxied by our backend. */
export const vodPlaylistUrl = (playlist: string) => apiUrl(playlist);

export const eventVodUrl = (eventId: string) =>
  apiUrl(`api/playback/event/${encodeURIComponent(eventId)}/vod/index.m3u8`);

export const eventClipUrl = (eventId: string) =>
  apiUrl(`api/playback/event/${encodeURIComponent(eventId)}/clip.mp4`);

/** Cheap liveness check used before opening the SSE stream. */
export const backendReachable = async () => {
  if (DEMO_MODE) return false;
  try {
    const response = await fetch(apiUrl("api/status"), { headers: { accept: "application/json" } });
    return response.ok;
  } catch {
    return false;
  }
};

async function getJson<T>(path: string, demoValue?: () => T): Promise<T> {
  if (DEMO_MODE && demoValue) return demoValue();
  let response: Response;
  try {
    response = await fetch(apiUrl(path), { headers: { accept: "application/json" } });
  } catch {
    throw new ApiError(0, "BACKEND_UNREACHABLE", "The add-on backend is not reachable.");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: string; message?: string }
      | null;
    throw new ApiError(
      response.status,
      body?.error ?? `HTTP_${response.status}`,
      body?.message ?? "The request failed.",
    );
  }
  if (!response.headers.get("content-type")?.includes("json")) {
    throw new ApiError(0, "BACKEND_UNREACHABLE", "The add-on backend is not reachable.");
  }
  return (await response.json()) as T;
}

async function sendJson<T>(path: string, method: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError(0, "BACKEND_UNREACHABLE", "The add-on backend is not reachable.");
  }
  const parsed = (await response.json().catch(() => null)) as any;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      parsed?.error ?? `HTTP_${response.status}`,
      parsed?.message ?? "The request failed.",
    );
  }
  return parsed as T;
}

export const api = {
  status: () => getJson<AppStatus>("api/status", demo.status),
  testConnection: async () => {
    try {
      return await sendJson<{ connected: boolean; error?: string }>("api/status/test", "POST", {});
    } catch (error) {
      return { connected: false, error: (error as ApiError).message };
    }
  },
  diagnostics: () => getJson<Diagnostics>("api/diagnostics", demo.diagnostics),
  cameras: () => getJson<Camera[]>("api/cameras", demo.cameras),
  camera: (id: string) => getJson<CameraDetail>(`api/cameras/${encodeURIComponent(id)}`, () => demo.camera(id)),
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
  event: (id: string) => getJson<DetectionEvent | null>(`api/events/${encodeURIComponent(id)}`),
  playbackWindow: (camera: string, at: number, windowMs = 300_000) =>
    getJson<PlaybackWindow>(
      `api/playback/${encodeURIComponent(camera)}/window?at=${Math.floor(at)}&window=${Math.floor(windowMs)}`,
    ),
  timeline: (camera: string, after: number, before: number) =>
    getJson<TimelineData>(
      `api/timeline/${encodeURIComponent(camera)}?after=${Math.floor(after)}&before=${Math.floor(before)}`,
      () => demo.timeline(camera, after, before),
    ),
  session: () =>
    getJson<{ userName: string | null; isAdmin?: boolean; preferences: Preferences }>(
      "api/session",
      demo.session,
    ),
  savePreferences: (patch: Partial<Preferences>) =>
    sendJson<Preferences>("api/preferences", "PUT", patch),
  exportClip: async (camera: string, start: number, end: number) => {
    await sendJson("api/exports", "POST", { camera, start, end });
    return true;
  },
};
