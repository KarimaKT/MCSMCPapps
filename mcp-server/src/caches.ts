/**
 * In-memory caches keyed by user `oid` (Entra object id). Single-process
 * only — fine for App Service B1 with default ARR affinity (one instance,
 * sticky sessions). Scale-out → move to Redis (future work).
 *
 * Two caches:
 *
 *  1. Power Platform OBO token cache. The OBO exchange takes 100-500ms
 *     and the resulting token lives ~1h. Reuse it across turns.
 *  2. CS conversation id cache. Opening a CS conversation via
 *     `startConversationStreaming` takes 1-4s. Reuse the id across turns
 *     so we only do that once per (user, agent) session.
 *
 * Both caches expire entries lazily on read; nothing reaps in the
 * background. Memory footprint is bounded by `MAX_ENTRIES` (LRU eviction
 * by oldest insertion when exceeded).
 */

const MAX_ENTRIES = 500;

interface PpTokenEntry {
  token: string;
  /** Absolute ms epoch when the token expires. */
  expiresAtMs: number;
}

interface ConversationEntry {
  conversationId: string;
  /** Absolute ms epoch when we'll force a fresh start. */
  expiresAtMs: number;
  /** Last time this entry was read or written, for diagnostics. */
  lastUsedMs: number;
}

const ppTokens = new Map<string, PpTokenEntry>();
const conversations = new Map<string, ConversationEntry>();

/** Clamp a Map to MAX_ENTRIES by deleting oldest insertion order. */
function clamp<T>(m: Map<string, T>): void {
  while (m.size > MAX_ENTRIES) {
    const oldest = m.keys().next().value;
    if (typeof oldest !== 'string') break;
    m.delete(oldest);
  }
}

// ----- PP token cache --------------------------------------------------

/** Read a non-expired PP token for this user, or null. Returns ms-of-life
 *  remaining for diagnostics. */
export function getCachedPpToken(
  oid: string
): { token: string; remainingMs: number } | null {
  const e = ppTokens.get(oid);
  if (!e) return null;
  const remainingMs = e.expiresAtMs - Date.now();
  // Skip if <60s remaining — avoid handing out a token about to expire
  // mid-call.
  if (remainingMs < 60_000) {
    ppTokens.delete(oid);
    return null;
  }
  return { token: e.token, remainingMs };
}

/** Cache a freshly-OBO'd PP token. expiresInSec from the token endpoint. */
export function setCachedPpToken(
  oid: string,
  token: string,
  expiresInSec: number
): void {
  // Re-insert to move to most-recent in insertion order.
  ppTokens.delete(oid);
  ppTokens.set(oid, {
    token,
    expiresAtMs: Date.now() + expiresInSec * 1000
  });
  clamp(ppTokens);
}

// ----- Conversation id cache ------------------------------------------

/** TTL for cached CS conversation ids. CS itself idles conversations out
 *  somewhere around 30 min; we use 25 min to stay comfortably inside. */
const CONVERSATION_TTL_MS = 25 * 60 * 1000;

export function getCachedConversationId(oid: string): string | null {
  const e = conversations.get(oid);
  if (!e) return null;
  if (Date.now() > e.expiresAtMs) {
    conversations.delete(oid);
    return null;
  }
  e.lastUsedMs = Date.now();
  return e.conversationId;
}

export function setCachedConversationId(
  oid: string,
  conversationId: string
): void {
  conversations.delete(oid);
  conversations.set(oid, {
    conversationId,
    expiresAtMs: Date.now() + CONVERSATION_TTL_MS,
    lastUsedMs: Date.now()
  });
  clamp(conversations);
}

/** Drop the cached convId — call when CS returns "conversation not found"
 *  or any error that suggests the cached id is stale. */
export function clearCachedConversationId(oid: string): void {
  conversations.delete(oid);
}

/** Diagnostics for /healthz or logs. */
export function cacheStats(): {
  ppTokenCount: number;
  conversationCount: number;
} {
  return {
    ppTokenCount: ppTokens.size,
    conversationCount: conversations.size
  };
}
