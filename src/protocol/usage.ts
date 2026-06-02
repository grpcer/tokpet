// SPDX-License-Identifier: Apache-2.0
//
// Tokpet data contract — Usage types.
//
// Every provider's `fetch()` must return one of the standardized shapes
// defined here. Each access mode maps to a distinct Usage variant,
// discriminated by the `mode` field.

export type ProviderMode = 'subscription' | 'api-key' | 'relay';

export interface UsageBase {
  readonly fetchedAt: Date;
  readonly source: 'live' | 'cached' | 'stale' | 'estimated';
  /**
   * When `source === 'stale'`, the timestamp of the underlying successful
   * fetch this snapshot was carried over from. Consumers can render this
   * as "stale for X minutes" and decide their own freshness thresholds.
   */
  readonly staleSince?: Date;
}

/** A rolling-window quota slice (e.g. 5h, 7d, monthly). */
export interface UsageWindow {
  readonly id: string;
  readonly label: string;
  /** Percentage already used in this window, 0–100. */
  readonly usedPct: number;
  readonly resetsAt?: Date;
  readonly durationMins?: number;
}

/**
 * Balance / cumulative spend (shared by api-key and relay modes).
 *
 * Vendors expose one of two shapes; this single interface covers both:
 *   1. Used-vs-total (OpenAI dashboard, monthly quotas): set `used` and `total`.
 *   2. Pre-paid remaining (DeepSeek, Aliyun, Volcengine): set `remaining` only —
 *      upstream reports the wallet balance directly without a "total ever spent."
 * At least one of `used` / `total` / `remaining` must be set.
 */
export interface UsageBalance {
  /** Cumulative spend. Undefined for pre-paid providers that only report remaining. */
  readonly used?: number;
  /** Total cap. Undefined when unknown / unlimited / not applicable (pre-paid). */
  readonly total?: number;
  /** Current remaining balance. Primary number for pre-paid providers. */
  readonly remaining?: number;
  readonly currency: 'USD' | 'CNY' | 'EUR' | 'credits' | 'tokens';
  readonly period?: 'monthly' | 'weekly' | 'daily' | 'lifetime';
  readonly resetsAt?: Date;
}

/** Mode 1: subscription with rolling-window quotas. */
export interface SubscriptionUsage extends UsageBase {
  readonly mode: 'subscription';
  readonly windows: readonly UsageWindow[];
  /** Optional overage credit balance. */
  readonly balance?: UsageBalance;
}

/** Mode 2: direct API key with cumulative spend / credit balance. */
export interface ApiKeyUsage extends UsageBase {
  readonly mode: 'api-key';
  readonly balance: UsageBalance;
  readonly breakdown?: ReadonlyArray<{ day: Date; used: number }>;
}

/** Mode 3: third-party relay. Generic envelope; UI renders by provider id. */
export interface RelayUsage extends UsageBase {
  readonly mode: 'relay';
  readonly balance?: UsageBalance;
  readonly windows?: readonly UsageWindow[];
  /** Free-form vendor-specific fields. */
  readonly custom?: Readonly<Record<string, unknown>>;
}

export type Usage = SubscriptionUsage | ApiKeyUsage | RelayUsage;

/** Standardized error result. Providers MUST return this rather than throw. */
export interface UsageError {
  readonly kind: 'error';
  readonly code:
    | 'not-configured'
    | 'auth-expired'
    | 'rate-limited'
    | 'network'
    | 'upstream-error'
    | 'unknown';
  readonly message: string;
  readonly retryAfter?: Date;
  readonly fetchedAt: Date;
}

export type UsageResult = Usage | UsageError;

export function isUsageError(r: UsageResult): r is UsageError {
  return (r as UsageError).kind === 'error';
}

/**
 * Transient codes describe failures we expect to clear up on their own —
 * an expired OAuth token waiting on a refresh, vendor 5xx, network blip,
 * rate limit cooldown. Terminal codes (`not-configured`) require user
 * action and should not be smoothed over with stale data.
 */
export function isTransientErrorCode(code: UsageError['code']): boolean {
  return code !== 'not-configured';
}
