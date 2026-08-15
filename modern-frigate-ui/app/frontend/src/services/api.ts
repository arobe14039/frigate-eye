import { demo } from "./demoData";
import type {
  AppStatus,
  Camera,
  CameraDetail,
  DetectionEvent,
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

/** Media URLs always point at our own backend, never at Frigate. */
export const cameraPreviewUrl = (cameraId: string, height = 360, bust?: number) =>
  apiUrl(`api/cameras/${encodeURIComponent(cameraId)}/preview?h=${height}${bust ? `&t=${bust}` : ""}`);

export const eventThumbnailUrl = (eventId: string) =>
  apiUrl(`api/events/${encodeURIComponent(eventId)}/thumbnail`);

export const eventSnapshotUrl = (eventId: string) =>
  apiUrl(`api/events/${encodeURIComponent(eventId)}/snapshot`);

export const recordingFrameUrl = (cameraId: string, timestamp: number) =>
  apiUrl(`api/recordings/${encodeURIComponent(cameraId)}/frame/${Math.floor(timestamp)}`);

let demoMode = false;
export const isDemoMode = () => demoMode;

async function getJson<T>(path: string, fallback: () => T): Promise<T> {
  try {
    const response = await fetch(apiUrl(path), { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(String(response.status));
    demoMode = false;
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
    try {
      const response = await fetch(apiUrl("api/status/test"), { method: "POST" });
      return (await response.json()) as { connected: boolean; error?: string };
    } catch {
      return { connected: false, error: "Backend unreachable" };
    }
  },
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
