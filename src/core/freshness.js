// Data provenance. Every screen shows one of these states, and the planner
// changes its wording when the data is stale or synthetic.

export const FRESH_MINUTES = 60;
export const STALE_HOURS = 3;

/**
 * @param source 'live' | 'cache' | 'demo'
 * @param fetchedAt unix seconds when the provider response was received
 * @param now unix seconds
 */
export function freshness(source, fetchedAt, now, span) {
  if (source === 'demo') {
    return { key: 'synthetic', label: 'Synthetic demo', detail: 'Invented values for a fixed reference week. Not a forecast.' };
  }
  const age = Math.max(0, now - fetchedAt);
  // A forecast whose final hour is already over has nothing left to say.
  if (span && now >= span.end) {
    return { key: 'expired', label: 'Expired', detail: 'Every hour in this forecast is in the past.', age };
  }
  if (age >= STALE_HOURS * 3600) {
    return { key: 'stale', label: 'Stale', detail: 'Retrieved over three hours ago. Refresh before relying on it.', age };
  }
  if (source === 'cache' || age >= FRESH_MINUTES * 60) {
    return { key: 'cached', label: 'Cached', detail: 'A saved copy from earlier, not a fresh request.', age };
  }
  return { key: 'live', label: 'Live', detail: 'Retrieved from Open-Meteo in this visit.', age };
}
