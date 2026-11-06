// Open-Meteo access. Requests time out, can be cancelled, and report
// failures as typed errors the interface can explain.
// Forecast: https://open-meteo.com/en/docs   Geocoding: https://open-meteo.com/en/docs/geocoding-api

import { inRange } from '../core/num.js';

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const TIMEOUT_MS = 12000;

export class ApiError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ApiError';
    this.code = code; // offline | timeout | rate-limit | provider | network | aborted | invalid
  }
}

async function getJson(url, signal) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError('You appear to be offline.', 'offline');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort('timeout'), TIMEOUT_MS);
  const onAbort = () => ctrl.abort('aborted');
  signal?.addEventListener('abort', onAbort, { once: true });
  let res;
  try {
    res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' }, referrerPolicy: 'no-referrer', credentials: 'omit' });
  } catch (err) {
    if (ctrl.signal.aborted) {
      throw ctrl.signal.reason === 'timeout'
        ? new ApiError('The weather service took too long to answer.', 'timeout')
        : new ApiError('Request cancelled.', 'aborted');
    }
    throw new ApiError('Could not reach the weather service.', 'network');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.status === 429) throw new ApiError('The weather service is receiving too many requests. Try again in a minute.', 'rate-limit');
  if (!res.ok) {
    const reason = body && typeof body.reason === 'string' ? body.reason.slice(0, 200) : `HTTP ${res.status}`;
    throw new ApiError(`The weather service could not answer: ${reason}`, 'provider');
  }
  if (!body || typeof body !== 'object') throw new ApiError('The weather service returned an unreadable response.', 'invalid');
  return body;
}

export const FORECAST_PARAMS = {
  current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code,cloud_cover,is_day,precipitation',
  hourly: 'temperature_2m,apparent_temperature,relative_humidity_2m,uv_index,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,weather_code,cloud_cover,is_day',
  daily: 'temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,weather_code,sunrise,sunset',
};

/** Coordinates are rounded to 0.01° (about 1 km) before they leave the browser. */
export function coarse(v) {
  return Math.round(v * 100) / 100;
}

export async function fetchForecast(place, signal) {
  const q = new URLSearchParams({
    latitude: String(coarse(place.lat)),
    longitude: String(coarse(place.lon)),
    timezone: 'auto',
    timeformat: 'unixtime',
    forecast_days: '7',
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh',
    precipitation_unit: 'mm',
    ...FORECAST_PARAMS,
  });
  return getJson(`${FORECAST}?${q}`, signal);
}

export async function searchPlaces(name, signal) {
  const q = new URLSearchParams({ name, count: '8', language: 'en', format: 'json' });
  const body = await getJson(`${GEOCODE}?${q}`, signal);
  const list = Array.isArray(body.results) ? body.results : [];
  return list
    .filter((r) => r && typeof r.name === 'string' && inRange(r.latitude, -90, 90) && inRange(r.longitude, -180, 180))
    .map((r) => ({
      name: r.name.slice(0, 80),
      detail: [r.admin1, r.country].filter((x) => typeof x === 'string' && x).join(', ').slice(0, 120),
      lat: r.latitude,
      lon: r.longitude,
    }));
}
