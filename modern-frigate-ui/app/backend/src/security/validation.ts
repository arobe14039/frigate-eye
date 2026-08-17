import { z } from "zod";
import { config } from "../config.js";

/**
 * Request validation. Every browser-supplied identifier, timestamp and media
 * path is checked here so no route can be coerced into an arbitrary Frigate
 * reverse proxy or an NVR-crushing range query.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (code: string, message: string) => new HttpError(400, code, message);

/** Frigate camera names are config keys: letters, digits, `_` and `-`. */
export const cameraId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Camera names may only contain letters, digits, _ and -");

/** Frigate event ids look like `1699999999.123456-abcdef`. */
export const eventId = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[A-Za-z0-9._-]+$/, "Malformed event id");

export const epochMs = z
  .coerce.number()
  .refine((value) => Number.isFinite(value), "Timestamp must be a finite number")
  .refine((value) => value > 0 && value < 4_000_000_000_000, "Timestamp out of range");

export const cameraParams = z.object({ camera: cameraId });
export const eventParams = z.object({ id: eventId });

/** `after <= before`, positive, and bounded by the configured maximum. */
export function parseRange(
  afterRaw: unknown,
  beforeRaw: unknown,
  maxSeconds = config.maxRangeSeconds,
): { after: number; before: number } {
  const before = beforeRaw === undefined || beforeRaw === "" ? Date.now() : epochMs.parse(beforeRaw);
  const after =
    afterRaw === undefined || afterRaw === ""
      ? before - 60 * 60 * 1000
      : epochMs.parse(afterRaw);
  if (!(after < before)) {
    throw badRequest("INVALID_RANGE", "End time must be after start time.");
  }
  if (before - after > maxSeconds * 1000) {
    throw badRequest(
      "RANGE_TOO_LARGE",
      `Requested range is too long. The maximum is ${Math.round(maxSeconds / 60)} minutes.`,
    );
  }
  return { after, before };
}

export const exportBody = z
  .object({ camera: cameraId, start: epochMs, end: epochMs })
  .superRefine((value, ctx) => {
    if (!(value.start < value.end)) {
      ctx.addIssue({ code: "custom", message: "End time must be after start time." });
      return;
    }
    if (value.end - value.start > config.maxExportSeconds * 1000) {
      ctx.addIssue({
        code: "custom",
        message: `Exports are limited to ${Math.round(config.maxExportSeconds / 60)} minutes.`,
      });
    }
  });

export const eventQuery = z.object({
  cameras: z.string().max(512).optional(),
  labels: z.string().max(512).optional(),
  zones: z.string().max(512).optional(),
  after: epochMs.optional(),
  before: epochMs.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const csvList = (value: unknown, item: z.ZodTypeAny = z.string().max(64)) => {
  if (typeof value !== "string" || !value.length) return undefined;
  const parts = value.split(",").filter(Boolean).slice(0, 32);
  const parsed = z.array(item).max(32).safeParse(parts);
  if (!parsed.success) throw badRequest("INVALID_FILTER", "Filter values are not valid.");
  return parsed.data as string[];
};

/**
 * VOD path allowlist.
 *
 * Frigate's VOD muxer serves an HLS playlist plus fMP4/TS segments and an
 * initialisation segment; nothing else is ever needed for playback. Anything
 * outside these exact shapes — traversal, encoded traversal, absolute URLs,
 * query strings, fragments, other Frigate endpoints — is rejected rather than
 * concatenated into an upstream URL.
 */
const VOD_ALLOWED = [
  /^index\.m3u8$/,
  /^master\.m3u8$/,
  /^init(-[A-Za-z0-9_-]{1,32})?\.mp4$/,
  /^[A-Za-z0-9_-]{1,64}\.m3u8$/,
  /^[A-Za-z0-9_-]{1,64}\.(ts|m4s|mp4|aac)$/,
];

export function assertSafeVodPath(rest: string): string {
  const path = rest ?? "";
  if (path === "") return "index.m3u8";
  if (path.length > 128) throw badRequest("INVALID_MEDIA_PATH", "Media path rejected.");
  // Reject anything that could escape the intended resource before decoding
  // tricks are considered.
  if (
    path.includes("..") ||
    path.includes("//") ||
    path.includes("\\") ||
    path.includes("?") ||
    path.includes("#") ||
    path.includes("%") ||
    /[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path) ||
    path.startsWith("/")
  ) {
    throw badRequest("INVALID_MEDIA_PATH", "Media path rejected.");
  }
  const segments = path.split("/");
  if (segments.length > 2) throw badRequest("INVALID_MEDIA_PATH", "Media path rejected.");
  const file = segments[segments.length - 1] ?? "";
  if (segments.length === 2 && !/^[A-Za-z0-9_-]{1,64}$/.test(segments[0] ?? "")) {
    throw badRequest("INVALID_MEDIA_PATH", "Media path rejected.");
  }
  if (!VOD_ALLOWED.some((pattern) => pattern.test(file))) {
    throw badRequest("INVALID_MEDIA_PATH", "Media path rejected.");
  }
  return path;
}
