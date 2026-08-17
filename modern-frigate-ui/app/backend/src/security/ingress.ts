import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "../config.js";

/**
 * Home Assistant Ingress trust boundary.
 *
 * Home Assistant authentication only means something if the backend cannot be
 * reached around Ingress. The Supervisor puts every add-on on the internal
 * `hassio` network (172.30.32.0/23) and proxies browser traffic — plus the
 * watchdog health check — from the Supervisor itself (172.30.32.2). Anything
 * arriving from another source is a container on the user's Docker network
 * talking to us directly and is refused.
 *
 * Trust levels:
 *   - `ingress`  request came through the Supervisor Ingress proxy (has the
 *                Ingress path header). Identity headers may be trusted.
 *   - `internal` Supervisor network but not Ingress (watchdog, curl from the
 *                host during debugging). Health only.
 *   - `untrusted` anything else. 403.
 */
export type TrustLevel = "ingress" | "internal" | "untrusted";

export interface RequestIdentity {
  trustedIngress: boolean;
  userId: string;
  userName: string | null;
  /** Present only for a trusted Ingress request that Home Assistant marks admin. */
  isAdmin: boolean;
}

/** IPv4/IPv6-mapped address → 32-bit number, or null when not IPv4. */
function toIpv4(address: string): number | null {
  const plain = address.replace(/^::ffff:/i, "");
  const parts = plain.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function inCidr(address: string, cidr: string): boolean {
  const [network, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  const ip = toIpv4(address);
  const net = toIpv4(network ?? "");
  if (ip === null || net === null || !Number.isInteger(bits)) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) === (net & mask);
}

/**
 * Supervisor-managed networks. Documented Ingress source is the Supervisor at
 * 172.30.32.2 on the 172.30.32.0/23 `hassio` network; loopback covers local
 * development and in-container smoke tests.
 */
export const SUPERVISOR_NETWORKS = ["172.30.32.0/23", "127.0.0.0/8"];

export function isSupervisorSource(address: string | undefined): boolean {
  if (!address) return false;
  if (address === "::1") return true;
  return SUPERVISOR_NETWORKS.some((cidr) => inCidr(address, cidr));
}

/** Supervisor sets this on every proxied Ingress request. */
const hasIngressMarker = (headers: Record<string, unknown>) =>
  typeof headers["x-ingress-path"] === "string" || typeof headers["x-hassio-key"] === "string";

export function classifyRequest(
  remoteAddress: string | undefined,
  headers: Record<string, unknown>,
): TrustLevel {
  if (!isSupervisorSource(remoteAddress)) return "untrusted";
  return hasIngressMarker(headers) ? "ingress" : "internal";
}

const USER_ID_PATTERN = /^[a-zA-Z0-9_-]{6,64}$/;

/**
 * Identity for per-user preferences. Only headers on a request that actually
 * arrived through Ingress are trusted; a direct client sending
 * `x-remote-user-id: admin` gets the anonymous scope (and is refused earlier
 * by the trust hook anyway).
 */
export function resolveIdentity(request: FastifyRequest): RequestIdentity {
  const trust = (request as any).trustLevel as TrustLevel | undefined;
  const headers = request.headers as Record<string, unknown>;
  if (trust !== "ingress") {
    return { trustedIngress: false, userId: "local", userName: null, isAdmin: false };
  }
  const id = headers["x-remote-user-id"];
  const name = headers["x-remote-user-display-name"] ?? headers["x-remote-user-name"];
  const admin = headers["x-remote-user-is-admin"];
  return {
    trustedIngress: true,
    userId: typeof id === "string" && USER_ID_PATTERN.test(id) ? id : "local",
    userName: typeof name === "string" && name.length > 0 && name.length < 64 ? name : null,
    isAdmin: admin === "1" || admin === "true",
  };
}

/**
 * Register the trust boundary. `/health` stays reachable from the Supervisor
 * network without Ingress so the watchdog never restarts a healthy add-on.
 */
export function registerIngressGuard(app: FastifyInstance) {
  app.decorateRequest("trustLevel", "untrusted");

  app.addHook("onRequest", async (request, reply) => {
    const trust = classifyRequest(
      request.socket.remoteAddress ?? request.ip,
      request.headers as Record<string, unknown>,
    );
    (request as any).trustLevel = trust;

    if (!config.enforceIngress) return;
    if (trust === "ingress") return;
    if (trust === "internal" && (request.url === "/health" || request.url.startsWith("/health?")))
      return;

    request.log.warn(
      { ip: request.socket.remoteAddress, trust, path: request.url },
      "rejected non-ingress request",
    );
    return reply.code(403).send({
      error: "FORBIDDEN_NON_INGRESS",
      message: "This add-on is only reachable through Home Assistant.",
    });
  });
}
