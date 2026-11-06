// WMO weather interpretation codes as used by Open-Meteo.
// https://open-meteo.com/en/docs (section "WMO Weather interpretation codes")

const TABLE = [
  [[0], 'Clear sky', 'clear'],
  [[1], 'Mainly clear', 'partly'],
  [[2], 'Partly cloudy', 'partly'],
  [[3], 'Overcast', 'cloudy'],
  [[45, 48], 'Fog', 'fog'],
  [[51, 53, 55], 'Drizzle', 'drizzle'],
  [[56, 57], 'Freezing drizzle', 'drizzle'],
  [[61, 63, 65], 'Rain', 'rain'],
  [[66, 67], 'Freezing rain', 'rain'],
  [[71, 73, 75, 77], 'Snow', 'snow'],
  [[80, 81, 82], 'Rain showers', 'rain'],
  [[85, 86], 'Snow showers', 'snow'],
  [[95], 'Thunderstorm', 'storm'],
  [[96, 99], 'Thunderstorm with hail', 'storm'],
];

export function describeCode(code) {
  for (const [codes, label, group] of TABLE) {
    if (codes.includes(code)) return { label, group };
  }
  return { label: 'Conditions unavailable', group: 'unknown' };
}

/** UV categories follow the WHO Global Solar UV Index. */
export function uvCategory(uv) {
  if (typeof uv !== 'number' || !Number.isFinite(uv)) return null;
  if (uv < 3) return { key: 'low', label: 'Low', advice: 'Low UV. Low is not zero; protection may still be worthwhile for long exposure.' };
  if (uv < 6) return { key: 'moderate', label: 'Moderate', advice: 'Sun protection recommended around midday: shade, clothing, hat, sunscreen.' };
  if (uv < 8) return { key: 'high', label: 'High', advice: 'Sun protection needed. Seek shade around midday.' };
  if (uv < 11) return { key: 'very-high', label: 'Very high', advice: 'Extra protection needed. Avoid direct midday sun where possible.' };
  return { key: 'extreme', label: 'Extreme', advice: 'Extra protection needed. Avoid being outside in direct midday sun where possible.' };
}
