import { EventEmitter } from "node:events";
import { config } from "../config.js";
import { listEvents } from "./frigate/events.js";
import type { DetectionEvent } from "./frigate/types.js";

/**
 * Realtime detections.
 *
 * The delivery path is always: Frigate → this backend adapter → SSE → browser.
 * No Frigate address, MQTT broker or credential ever reaches the client.
 *
 * Frigate's HTTP API has no stable push channel (its own UI uses the MQTT
 * bridge, which would mean shipping broker credentials into this add-on), so
 * the reliable, honestly-documented provider is polling. The provider
 * interface exists so an MQTT/WebSocket provider can be dropped in later
 * without touching the SSE route or the frontend.
 */
export interface RealtimeEventProvider {
  readonly name: string;
  start(emit: (event: DetectionEvent) => void): void;
  stop(): void;
}

/**
 * Polling provider. Deduplicates by event id + end state, so an event that is
 * still in progress is emitted once while it starts and once when it ends,
 * never repeatedly on each poll.
 */
export class PollingRealtimeProvider implements RealtimeEventProvider {
  readonly name = "polling";
  private timer: NodeJS.Timeout | null = null;
  private seen = new Map<string, number>();

  constructor(private intervalMs = config.eventPollMs) {}

  start(emit: (event: DetectionEvent) => void) {
    if (this.timer) return;
    const tick = async () => {
      try {
        const events = await listEvents({ limit: 20 });
        for (const event of events.slice().reverse()) {
          const stamp = event.endTime ?? 0;
          const previous = this.seen.get(event.id);
          if (previous !== undefined && previous === stamp) continue;
          this.seen.set(event.id, stamp);
          emit(event);
        }
        // Bound the dedupe map; detections are only interesting while fresh.
        if (this.seen.size > 500) {
          for (const key of [...this.seen.keys()].slice(0, this.seen.size - 500)) {
            this.seen.delete(key);
          }
        }
      } catch {
        /* Frigate offline — /api/status reports it, stay quiet here */
      }
    };
    this.timer = setInterval(() => void tick(), this.intervalMs);
    void tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.seen.clear();
  }
}

class EventStream extends EventEmitter {
  private subscribers = 0;
  constructor(private provider: RealtimeEventProvider = new PollingRealtimeProvider()) {
    super();
  }

  get providerName() {
    return this.provider.name;
  }

  subscribe(onEvent: (event: DetectionEvent) => void) {
    this.subscribers += 1;
    this.on("detection", onEvent);
    if (this.subscribers === 1) {
      this.provider.start((event) => this.emit("detection", event));
    }
    return () => {
      this.off("detection", onEvent);
      this.subscribers -= 1;
      if (this.subscribers <= 0) this.provider.stop();
    };
  }
}

export const eventStream = new EventStream();
