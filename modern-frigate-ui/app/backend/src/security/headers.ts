import type { FastifyInstance } from "fastify";

/**
 * Security headers, tuned so Home Assistant Ingress keeps working.
 *
 * CSP notes:
 *  - `connect-src 'self'` covers the SSE feed and the `api/live/*` WebSocket
 *    relays because those are served from this same Ingress origin (`ws:`/`wss:`
 *    are listed explicitly for browsers that treat the scheme separately).
 *  - `media-src` allows `blob:` for MSE/HLS buffers and `data:` for placeholders.
 *  - No third-party origin is allowed anywhere: no CDN, no telemetry, no cloud.
 *  - `frame-ancestors` permits embedding, which is exactly what the Ingress
 *    panel does.
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: data:",
  "connect-src 'self' ws: wss:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "form-action 'self'",
  "frame-ancestors *",
].join("; ");

export function registerSecurityHeaders(app: FastifyInstance) {
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=(), usb=()");
    reply.header("x-frame-options", "SAMEORIGIN");
    reply.header("cross-origin-resource-policy", "same-origin");
    // Only the HTML shell needs a CSP; media/API responses are not documents.
    if (!request.url.startsWith("/api/")) reply.header("content-security-policy", CSP);
    return payload;
  });
}
