// Builders for Open-Meteo-shaped test responses (timeformat=unixtime).
// These are test fixtures only; they never ship as weather data.

export function buildRaw({ zone, offset, startUtc, days = 7, temp = (i) => 20 + 5 * Math.sin(i / 4), overrides = {} }) {
  const n = days * 24;
  const time = Array.from({ length: n }, (_, i) => startUtc + i * 3600);
  const series = (fn) => time.map((_, i) => fn(i));
  const daily = Array.from({ length: days }, (_, d) => startUtc + d * 86400);
  const raw = {
    latitude: 51.5,
    longitude: -0.12,
    timezone: zone,
    timezone_abbreviation: 'TST',
    utc_offset_seconds: offset,
    current: { time: startUtc + 10 * 3600, interval: 900, temperature_2m: 18, apparent_temperature: 17, relative_humidity_2m: 60, wind_speed_10m: 12, wind_direction_10m: 300, weather_code: 2, cloud_cover: 40, is_day: 1, precipitation: 0 },
    hourly_units: { temperature_2m: '°C', wind_speed_10m: 'km/h', relative_humidity_2m: '%' },
    hourly: {
      time,
      temperature_2m: series(temp),
      apparent_temperature: series((i) => temp(i) - 1),
      relative_humidity_2m: series((i) => 50 + (i % 24)),
      uv_index: series((i) => Math.max(0, 6 * Math.sin(((i % 24) - 6) * Math.PI / 12))),
      precipitation_probability: series((i) => (i % 24 > 15 ? 40 : 5)),
      precipitation: series(() => 0),
      wind_speed_10m: series((i) => 8 + (i % 6)),
      wind_direction_10m: series((i) => (280 + i * 3) % 360),
      weather_code: series(() => 2),
      cloud_cover: series(() => 30),
      is_day: series((i) => (i % 24 >= 6 && i % 24 < 18 ? 1 : 0)),
    },
    daily_units: { temperature_2m_max: '°C', precipitation_sum: 'mm' },
    daily: {
      time: daily,
      temperature_2m_max: daily.map((_, d) => Math.max(...time.slice(d * 24, d * 24 + 24).map((_, k) => temp(d * 24 + k)))),
      temperature_2m_min: daily.map((_, d) => Math.min(...time.slice(d * 24, d * 24 + 24).map((_, k) => temp(d * 24 + k)))),
      uv_index_max: daily.map(() => 6),
      precipitation_probability_max: daily.map(() => 40),
      precipitation_sum: daily.map(() => 0.4),
      wind_speed_10m_max: daily.map(() => 13),
      weather_code: daily.map(() => 2),
      sunrise: daily.map((t) => t + 7 * 3600),
      sunset: daily.map((t) => t + 17 * 3600),
    },
  };
  for (const [path, value] of Object.entries(overrides)) {
    const [a, b, c] = path.split('.');
    if (c !== undefined) raw[a][b][Number(c)] = value;
    else if (b !== undefined) raw[a][b] = value;
    else raw[a] = value;
  }
  return raw;
}

// London, week spanning the end of British Summer Time (Sun 25 Oct 2026, 02:00 BST -> 01:00 GMT).
export const LONDON_DST = {
  zone: 'Europe/London',
  offset: 3600,
  startUtc: Date.UTC(2026, 9, 21, 23, 0, 0) / 1000, // Thu 22 Oct 00:00 BST
};
