// SPDX-License-Identifier: Apache-2.0

/** Format a future timestamp as a short relative duration. Past → "now". */
export function relativeFromNow(target: Date | undefined): string {
  if (!target) return '—';
  const ms = target.getTime() - Date.now();
  if (ms <= 0) return 'now';
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
