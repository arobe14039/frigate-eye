import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { getCamera, listCameras, listLabels, getFrigateStats } from "../services/frigate/cameras.js";
import { frigateMeta, resolveFrigateBase, frigateFetch } from "../services/frigate/client.js";
import {
  buildGo2rtcSuggestion,
  go2rtcDiagnostics,
  resolveStreamName,
} from "../services/frigate/go2rtc.js";
import { getEvent, listEvents } from "../services/frigate/events.js";
import { requestExport } from "../services/frigate/exports.js";
import { streamOptions } from "../services/frigate/live.js";
import { cameraPreview, eventSnapshot, eventThumbnail, recordingFrame } from "../services/frigate/media.js";
import { getTimeline } from "../services/frigate/recordings.js";
import { eventStream } from "../services/eventStream.js";
import { haStatus } from "../services/homeAssistantService.js";
import { getPreferences, preferencesSchema, savePreferences } from "../services/preferences.js";
import { resolveIdentity } from "../security/ingress.js";
import { limiters } from "../security/rateLimit.js";
import {
  cameraId,
  cameraParams,
  csvList,
  epochMs,
  eventParams,
  eventQuery,
  exportBody,
  HttpError,
  parseRange,
} from "../security/validation.js";

const unavailable = (reply: any) =>
  reply.code(503).send({ error: "FRIGATE_UNAVAILABLE", message: "Frigate is not reachable." });

export async function registerApi(app: FastifyInstance) {
  const sendImage = async (
    reply: any,
    loader: () => Promise<{ body: Buffer; contentType: string; cacheControl: string }>,
  ) => {
    try {
      const image = await loader();
      reply.header("content-type", image.contentType);
      reply.header("cache-control", image.cacheControl);
      return reply.send(image.body);
    } catch {
      return reply
        .code(503)
        .send({ error: "MEDIA_UNAVAILABLE", message: "That image is not available right now." });
    }
  };

  /** Frigate reports its version as plain text, not JSON. */
  const frigateVersion = async () =>
    frigateFetch("/api/version")
      .then((res) => res.text())
      .then((text) => text.replace(/["\s]/g, "") || undefined)
      .catch(() => undefined);

  /** Total detection fps across detectors, with a top-level stats fallback. */
  const detectionFps = (stats: any): number | undefined => {
    if (!stats) return undefined;
    const detectors = Object.values<any>(stats.detectors ?? {});
    const summed = detectors.reduce((sum, d) => sum + Number(d?.detection_fps ?? 0), 0);
    if (summed > 0) return summed;
    const cameras = Object.values<any>(stats.cameras ?? {});
    const cameraSum = cameras.reduce((sum, c) => sum + Number(c?.detection_fps ?? 0), 0);
    if (cameraSum > 0) return cameraSum;
    const top = Number(stats.detection_fps ?? 0);
    return top > 0 ? top : undefined;
  };

  app.get("/api/status", async () => {
    const base = await resolveFrigateBase();
    const meta = frigateMeta();
    let version: string | undefined;
    let cameraCount: number | undefined;
    let detectorFps: number | undefined;

    if (base) {
      version = await frigateVersion();
      const cameras = await listCameras().catch(() => []);
      cameraCount = cameras.length;
      detectorFps = detectionFps(await getFrigateStats().catch(() => null));
    }

    return {
      app: {
        state: "online" as const,
        version: config.version,
        previewRefreshSeconds: config.previewRefreshSeconds,
      },
      frigate: {
        connected: Boolean(base),
        version,
        cameraCount,
        detectorFps,
        /** How it was found — never the internal hostname. */
        discoveredVia: meta.via,
        lastConnectedAt: meta.lastConnectedAt,
        lastAttemptAt: meta.lastAttemptAt,
        error: base ? undefined : (meta.lastError ?? undefined),
      },
      homeAssistant: await haStatus(),
      realtime: { provider: eventStream.providerName, pollSeconds: config.eventPollMs / 1000 },
    };
  });

  /**
   * Troubleshooting detail. Reachability, ports and stream mapping only — no
   * internal hostnames, no camera credentials. Restricted to Home Assistant
   * administrators on a trusted Ingress request.
   */
  app.get("/api/diagnostics", { preHandler: limiters.diagnostics }, async (request, reply) => {
    const identity = resolveIdentity(request);
    if (config.enforceIngress && !identity.isAdmin) {
      return reply
        .code(403)
        .send({ error: "ADMIN_REQUIRED", message: "Diagnostics are available to administrators." });
    }
    const go2rtc = await go2rtcDiagnostics();
    const cameras = await listCameras().catch(() => []);
    const streams = await Promise.all(
      cameras.map(async (camera) => {
        const resolved = await resolveStreamName(camera.id);
        return { camera: camera.id, streamName: resolved.name, matched: resolved.matched };
      }),
    );
    return {
      ports: [
        {
          label: "Frigate API",
          port: go2rtc.frigatePort,
          required: true,
          ok: go2rtc.frigateReachable,
          detail: go2rtc.frigateReachable
            ? "Reachable on the internal add-on network"
            : "No reachable Frigate instance",
        },
        {
          label: "go2rtc (live video)",
          port: go2rtc.go2rtcPort,
          required: false,
          ok: go2rtc.go2rtcDirect,
          detail: go2rtc.go2rtcDirect
            ? "Direct connection working"
            : "Port closed — enable it in the Frigate add-on network options for MSE/WebRTC",
        },
      ],
      liveVia: go2rtc.via,
      streamCount: go2rtc.streamCount,
      go2rtcStreams: go2rtc.streams,
      cameraStreams: streams,
      frigate: {
        reachable: go2rtc.frigateReachable,
        via: frigateMeta().via,
        lastConnectedAt: frigateMeta().lastConnectedAt,
        lastAttemptAt: frigateMeta().lastAttemptAt,
      },
      go2rtcSuggestion: await buildGo2rtcSuggestion(
        streams.filter((entry) => !entry.matched).map((entry) => entry.camera),
      ),
    };
  });

  app.post("/api/status/test", { preHandler: limiters.diagnostics }, async () => {
    const base = await resolveFrigateBase(true);
    return { connected: Boolean(base), via: frigateMeta().via, error: frigateMeta().lastError };
  });

  app.get("/api/session", async (request) => {
    const identity = resolveIdentity(request);
    return {
      userName: identity.userName,
      isAdmin: identity.isAdmin,
      trustedIngress: identity.trustedIngress,
      preferences: await getPreferences(identity.userId),
    };
  });

  app.put("/api/preferences", { preHandler: limiters.writes }, async (request, reply) => {
    const parsed = preferencesSchema.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "INVALID_PREFERENCES", message: "Those settings are not valid." });
    }
    const identity = resolveIdentity(request);
    try {
      return await savePreferences(identity.userId, parsed.data);
    } catch (error) {
      // Never report success for a save that did not reach disk.
      request.log.error({ err: (error as Error).message }, "preferences write failed");
      return reply
        .code(500)
        .send({ error: "PREFERENCES_WRITE_FAILED", message: "Your settings could not be saved." });
    }
  });

  app.get("/api/cameras", async (_request, reply) => {
    try {
      return await listCameras();
    } catch {
      return unavailable(reply);
    }
  });

  app.get<{ Params: { camera: string } }>("/api/cameras/:camera", async (request, reply) => {
    const { camera: id } = cameraParams.parse(request.params);
    const camera = await getCamera(id).catch(() => null);
    if (!camera) return reply.code(404).send({ error: "NOT_FOUND", message: "Unknown camera." });
    return { ...camera, streams: await streamOptions(camera.id) };
  });

  app.get<{ Params: { camera: string }; Querystring: { h?: string } }>(
    "/api/cameras/:camera/preview",
    { preHandler: limiters.snapshots },
    (request, reply) => {
      const { camera } = cameraParams.parse(request.params);
      const height = Math.min(Math.max(Number(request.query.h ?? 360) || 360, 90), 720);
      return sendImage(reply, () => cameraPreview(camera, height));
    },
  );

  app.get("/api/labels", async (_request, reply) => {
    try {
      return await listLabels();
    } catch {
      return unavailable(reply);
    }
  });

  app.get("/api/events", async (request, reply) => {
    const q = eventQuery.parse(request.query);
    if (q.after !== undefined && q.before !== undefined && !(q.after < q.before)) {
      throw new HttpError(400, "INVALID_RANGE", "End time must be after start time.");
    }
    try {
      return await listEvents({
        cameras: csvList(q.cameras, cameraId),
        labels: csvList(q.labels),
        zones: csvList(q.zones),
        after: q.after,
        before: q.before,
        limit: q.limit,
      });
    } catch {
      return unavailable(reply);
    }
  });

  app.get<{ Params: { id: string } }>("/api/events/:id", async (request, reply) => {
    const { id } = eventParams.parse(request.params);
    const event = await getEvent(id);
    if (!event) return reply.code(404).send({ error: "NOT_FOUND", message: "Unknown event." });
    return event;
  });

  app.get<{ Params: { id: string } }>(
    "/api/events/:id/thumbnail",
    { preHandler: limiters.snapshots },
    (request, reply) => sendImage(reply, () => eventThumbnail(eventParams.parse(request.params).id)),
  );

  app.get<{ Params: { id: string } }>(
    "/api/events/:id/snapshot",
    { preHandler: limiters.snapshots },
    (request, reply) => sendImage(reply, () => eventSnapshot(eventParams.parse(request.params).id)),
  );

  app.get<{ Params: { camera: string }; Querystring: { after?: string; before?: string } }>(
    "/api/timeline/:camera",
    async (request, reply) => {
      const { camera } = cameraParams.parse(request.params);
      const { after, before } = parseRange(request.query.after, request.query.before);
      try {
        return await getTimeline(camera, after, before);
      } catch {
        return unavailable(reply);
      }
    },
  );

  app.get<{ Params: { camera: string }; Querystring: { after?: string; before?: string } }>(
    "/api/recordings/:camera",
    async (request, reply) => {
      const { camera } = cameraParams.parse(request.params);
      const { after, before } = parseRange(request.query.after, request.query.before);
      try {
        return (await getTimeline(camera, after, before)).segments;
      } catch {
        return unavailable(reply);
      }
    },
  );

  app.get<{ Params: { camera: string; ts: string } }>(
    "/api/recordings/:camera/frame/:ts",
    { preHandler: limiters.snapshots },
    (request, reply) => {
      const { camera } = cameraParams.parse(request.params);
      const ts = epochMs.parse(request.params.ts);
      return sendImage(reply, () => recordingFrame(camera, ts));
    },
  );

  app.post<{ Body: unknown }>(
    "/api/exports",
    { preHandler: limiters.exports },
    async (request, reply) => {
      const parsed = exportBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "INVALID_EXPORT",
          message:
            parsed.error.issues[0]?.message ??
            `Exports must be a valid range of at most ${Math.round(config.maxExportSeconds / 60)} minutes.`,
        });
      }
      try {
        return await requestExport(parsed.data.camera, parsed.data.start, parsed.data.end);
      } catch {
        return unavailable(reply);
      }
    },
  );

  // Server-Sent Events: realtime detections for the frontend.
  app.get("/api/stream/events", (request, reply) => {
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    reply.raw.write(`: connected\n\n`);
    const heartbeat = setInterval(() => reply.raw.write(`: ping\n\n`), 25_000);
    const unsubscribe = eventStream.subscribe((event) => {
      reply.raw.write(`event: detection\ndata: ${JSON.stringify(event)}\n\n`);
    });
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
