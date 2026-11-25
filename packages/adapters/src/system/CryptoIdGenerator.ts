import type { EventId, IdGenerator, ListId, TaskId } from '@todolist/core';

/**
 * Production id source.
 *
 * Uses the platform's `crypto.randomUUID()` when present (browsers, Tauri's
 * webview, Node 19+, Hermes with the crypto polyfill). Otherwise falls back to
 * a timestamp + counter + random suffix. The fallback is only for uniqueness,
 * not cryptographic strength — ids are opaque handles, not secrets.
 *
 * Ids are prefixed (`task_`, `list_`, `event_`) so a stray id in a log tells
 * you what it refers to. Prefixed random strings still satisfy that ids are
 * globally unique.
 */
export class CryptoIdGenerator implements IdGenerator {
  task(): TaskId {
    return `task_${this.newUuid()}` as TaskId;
  }

  list(): ListId {
    return `list_${this.newUuid()}` as ListId;
  }

  event(): EventId {
    return `event_${this.newUuid()}` as EventId;
  }

  private newUuid(): string {
    const cryptoApi = globalThis.crypto as Crypto | undefined;
    if (typeof cryptoApi?.randomUUID === 'function') {
      return cryptoApi.randomUUID();
    }
    // Fallback: time + counter + randomness. Monotonic enough for a desktop app.
    fallbackSequence += 1;
    const random = Math.random().toString(36).slice(2, 10);
    return `${Date.now().toString(36)}-${fallbackSequence.toString(36)}-${random}`;
  }
}

/**
 * Module-scoped, so two generator instances created in the same tick still
 * never produce the same fallback id.
 */
let fallbackSequence = 0;
