import { frigateFetch } from "./client.js";

const IMAGE_CACHE = "public, max-age=30, stale-while-revalidate=60";
const SNAPSHOT_CACHE = "public, max-age=3";

/** Proxy an image from Frigate. The browser never learns Frigate's address. */
export async function proxyImage(path: string, cacheControl = IMAGE_CACHE) {
  const res = await frigateFetch(path);
  const body = Buffer.from(await res.arrayBuffer());
  return {
    body,
    contentType: res.headers.get("content-type") ?? "image/jpeg",
    cacheControl,
  };
}

export const eventThumbnail = (id: string) =>
  proxyImage(`/api/events/${encodeURIComponent(id)}/thumbnail.jpg`, "public, max-age=300");

export const eventSnapshot = (id: string) =>
  proxyImage(`/api/events/${encodeURIComponent(id)}/snapshot.jpg`, "public, max-age=300");

/**
 * Lightweight camera preview: Frigate's downscaled single JPEG frame.
 * `height` keeps a 180px card from downloading a 4K still.
 */
export const cameraPreview = (camera: string, height = 360) =>
  proxyImage(`/api/${encodeURIComponent(camera)}/latest.jpg?h=${height}`, SNAPSHOT_CACHE);

/** Recording preview frame used while scrubbing the timeline. */
export const recordingFrame = (camera: string, timestampMs: number, height = 240) =>
  proxyImage(
    `/api/${encodeURIComponent(camera)}/recordings/${Math.floor(timestampMs / 1000)}/snapshot.png?height=${height}`,
    "public, max-age=600",
  );
