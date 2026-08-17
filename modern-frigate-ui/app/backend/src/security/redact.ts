/**
 * Credential redaction.
 *
 * Camera RTSP URLs, Frigate/MQTT configuration and Supervisor tokens are all
 * secrets. Nothing in this file is cosmetic: every string that could carry a
 * credential passes through here before it is logged or serialised into an API
 * response, so the secret never leaves the process.
 */

const MASK = "***";

/** Keys whose values are always replaced, whatever they contain. */
const SECRET_KEYS = new Set(
  [
    "password",
    "pass",
    "passwd",
    "secret",
    "token",
    "authorization",
    "auth",
    "cookie",
    "apikey",
    "api_key",
    "access_token",
    "supervisor_token",
    "mqtt_password",
    "rtsp_password",
    "user_pass",
  ].map((key) => key.toLowerCase()),
);

/** Query/credential parameter names that carry secrets inside URLs. */
const SECRET_QUERY_KEYS = new Set([
  "password",
  "pass",
  "passwd",
  "token",
  "secret",
  "apikey",
  "api_key",
  "auth",
  "access_token",
  "user",
  "username",
]);

/**
 * Redact userinfo and credential query parameters from a URL-ish string.
 *
 * Works for any scheme (`rtsp://`, `rtmp://`, `http(s)://`, `ws://`) and does
 * not depend on `URL` parsing succeeding, because camera URLs frequently
 * contain characters that make `new URL()` throw.
 */
export function redactUrl(value: string): string {
  if (typeof value !== "string" || !value) return value;

  // scheme://userinfo@host/... — userinfo may itself contain %-escapes and
  // punctuation, so it is matched lazily up to the LAST '@' before the path.
  let out = value.replace(
    /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/\s?#]*@)/g,
    (_match, scheme: string, userinfo: string) => {
      const creds = userinfo.slice(0, -1);
      if (!creds) return `${scheme}${userinfo}`;
      return creds.includes(":") ? `${scheme}${MASK}:${MASK}@` : `${scheme}${MASK}@`;
    },
  );

  // ?password=… / &token=… anywhere in the string.
  out = out.replace(/([?&])([^=&\s]+)=([^&\s#]*)/g, (match, sep: string, key: string, _v: string) =>
    SECRET_QUERY_KEYS.has(decodeURIComponent(key).toLowerCase()) ? `${sep}${key}=${MASK}` : match,
  );

  return out;
}

/** Any URL-looking substring inside free text is redacted. */
export function redactText(value: string): string {
  if (typeof value !== "string" || !value) return value;
  return value.replace(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s"']+/g, (url) => redactUrl(url));
}

/**
 * Deep-redact an arbitrary value: secret-named keys are masked outright,
 * strings are scanned for embedded URLs/credentials.
 */
export function redact<T>(input: T, depth = 0): T {
  if (depth > 8) return input;
  if (typeof input === "string") return redactText(input) as unknown as T;
  if (!input || typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map((item) => redact(item, depth + 1)) as unknown as T;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (SECRET_KEYS.has(key.toLowerCase())) {
      out[key] = MASK;
      continue;
    }
    out[key] = redact(value, depth + 1);
  }
  return out as unknown as T;
}

/** Pino serialiser hook: redacts every logged object and message string. */
export const logRedaction = {
  /** Header/keys pino removes before anything reaches a transport. */
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["x-supervisor-token"]',
    'req.headers["x-ha-access"]',
    "res.headers['set-cookie']",
    "upstreamUrl",
    "url",
    "src",
    "path",
    "*.password",
    "*.token",
  ],
  censor: (value: unknown) => (typeof value === "string" ? redactText(value) : MASK),
};
