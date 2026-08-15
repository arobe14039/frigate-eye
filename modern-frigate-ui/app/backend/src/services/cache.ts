type Entry<T> = { value: T; expires: number };

/** Tiny bounded in-memory TTL cache. */
export class TtlCache<T> {
  private map = new Map<string, Entry<T>>();
  constructor(
    private ttlMs: number,
    private maxEntries = 200,
  ) {}

  get(key: string): T | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T) {
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
  }

  async wrap(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const value = await fn();
    this.set(key, value);
    return value;
  }

  clear() {
    this.map.clear();
  }
}
