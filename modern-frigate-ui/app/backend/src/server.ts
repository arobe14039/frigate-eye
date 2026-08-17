import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";
import { registerApi } from "./routes/api.js";
import { registerLive } from "./routes/live.js";
import { registerPlayback } from "./routes/playback.js";
import { resolveFrigateBase } from "./services/frigate/client.js";
import { registerIngressGuard } from "./security/ingress.js";
import { registerSecurityHeaders } from "./security/headers.js";
import { logRedaction, redactText } from "./security/redact.js";
import { HttpError } from "./security/validation.js";

export function buildServer() {
  const app = Fastify({
    logger: { level: config.logLevel as any, redact: logRedaction },
    trustProxy: false,
    disableRequestLogging: false,
  });

  // Ingress and some clients send POSTs without a usable content-type; accept
  // those instead of answering 415.
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body: Buffer, done) => {
    const raw = body.toString("utf8").trim();
    if (!raw) return done(null, undefined);
    try {
      done(null, JSON.parse(raw));
    } catch {
      done(null, raw);
    }
  });

  registerIngressGuard(app);
  registerSecurityHeaders(app);

  /** Structured errors only — a stack trace is never sent to a browser. */
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.status).send({ error: error.code, message: error.message });
    }
    if ((error as any).validation || (error as any).name === "ZodError") {
      return reply.code(400).send({ error: "INVALID_REQUEST", message: "Request was not valid." });
    }
    request.log.error({ err: redactText(error.message) }, "unhandled route error");
    return reply
      .code(500)
      .send({ error: "INTERNAL_ERROR", message: "Something went wrong handling the request." });
  });

  return app;
}

export async function startServer() {
  const app = buildServer();

  await app.register(websocket, { options: { maxPayload: 8 * 1024 * 1024 } });
  await registerApi(app);
  await registerLive(app);
  await registerPlayback(app);

  /**
   * Supervisor watchdog target. Reports only whether THIS application is
   * alive — a Frigate outage must never get a healthy add-on restarted.
   * Dependency state lives in `/api/status`.
   */
  app.get("/health", async () => ({ status: "ok", version: config.version }));

  const staticRoot = resolve(config.staticDir);
  if (existsSync(staticRoot)) {
    await app.register(fastifyStatic, { root: staticRoot, wildcard: false });
    // SPA fallback: any non-API path serves the shell so nested URLs survive refresh.
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/"))
        return reply.code(404).send({ error: "NOT_FOUND", message: "Unknown endpoint." });
      return reply.sendFile("index.html");
    });
  }

  app.log.info(
    { version: config.version, enforceIngress: config.enforceIngress, supervised: config.supervised },
    "Modern Frigate UI starting",
  );

  void resolveFrigateBase().then((base) => {
    app.log.info(base ? "Frigate discovered on the internal network" : "Frigate not reachable yet");
  });

  await app.listen({ port: config.port, host: config.host });
  return app;
}

// Entrypoint guard so tests can import buildServer without binding a port.
if (process.env["NODE_ENV"] !== "test") {
  await startServer();
}
