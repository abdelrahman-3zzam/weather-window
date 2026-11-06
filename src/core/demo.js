// A deterministic synthetic week. It is shaped like an Open-Meteo response so
// it travels through the same validation as live data, but it is never
// fetched, never cached, and always labelled as synthetic in the interface.

export const DEMO_LOCATION = Object.freeze({
  name: 'Demo week',
  detail: 'Synthetic values, Nile Delta–like climate',
  lat: null,
  lon: null,
  demo: true,
});

const ZONE = 'Africa/Cairo';
const OFFSET = 3 * 3600; // Egypt observes summer time until the last Thursday of October.
const START = Date.UTC(2026, 9, 19, 0, 0, 0) / 1000 - OFFSET; // Mon 19 Oct 2026, 00:00 local

/** The fixed moment the demo treats as "now": Mon 19 Oct 2026, 09:00 local. */
export const DEMO_NOW = START + 9 * 3600;

const DAYS = {
  high: [27, 29, 31, 24, 23, 26, 28],
  low: [18, 19, 21, 17, 15, 17, 19],
  rhBase: [58, 54, 48, 78, 70, 62, 57],
  pop: [5, 0, 10, 65, 40, 10, 5],
  precip: [0, 0, 0, 4.2, 1.1, 0, 0],
  wind: [14, 12, 18, 32, 24, 15, 13],
  windDir: [330, 340, 20, 250, 275, 315, 345], // degrees the wind blows from
  uv: [6.1, 6.4, 6.0, 3.2, 4.5, 5.8, 6.2],
  cloud: [15, 5, 30, 85, 60, 25, 10],
  code: [1, 0, 2, 61, 80, 2, 1],
};

const SUNRISE = 6 * 3600 + 3 * 60;
const SUNSET = 17 * 3600 + 22 * 60;

function r1(v) {
  return Math.round(v * 10) / 10;
}

export function demoRaw() {
  const hourly = {
    time: [], temperature_2m: [], apparent_temperature: [], relative_humidity_2m: [], uv_index: [],
    precipitation_probability: [], precipitation: [], wind_speed_10m: [], wind_direction_10m: [], weather_code: [], cloud_cover: [], is_day: [],
  };
  const daily = {
    time: [], temperature_2m_max: [], temperature_2m_min: [], uv_index_max: [], precipitation_probability_max: [],
    precipitation_sum: [], wind_speed_10m_max: [], weather_code: [], sunrise: [], sunset: [],
  };

  for (let d = 0; d < 7; d += 1) {
    const midnight = START + d * 86400;
    daily.time.push(midnight);
    daily.temperature_2m_max.push(DAYS.high[d]);
    daily.temperature_2m_min.push(DAYS.low[d]);
    daily.uv_index_max.push(DAYS.uv[d]);
    daily.precipitation_probability_max.push(DAYS.pop[d]);
    daily.precipitation_sum.push(DAYS.precip[d]);
    daily.wind_speed_10m_max.push(DAYS.wind[d]);
    daily.weather_code.push(DAYS.code[d]);
    daily.sunrise.push(midnight + SUNRISE);
    daily.sunset.push(midnight + SUNSET);

    for (let h = 0; h < 24; h += 1) {
      const t = midnight + h * 3600;
      // Coolest near 05:00, warmest near 14:00.
      const phase = h >= 5 && h <= 14 ? (h - 5) / 9 : h > 14 ? 1 - (h - 14) / 15 : 1 - (h + 10) / 15;
      const heat = (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, phase)))) / 2;
      const temp = DAYS.low[d] + (DAYS.high[d] - DAYS.low[d]) * heat;
      const sec = h * 3600;
      const light = sec > SUNRISE && sec < SUNSET ? Math.sin(Math.PI * (sec - SUNRISE) / (SUNSET - SUNRISE)) : 0;
      const rainy = DAYS.pop[d] > 30 && h >= 10 && h <= 17;
      hourly.time.push(t);
      hourly.temperature_2m.push(r1(temp));
      hourly.apparent_temperature.push(r1(temp + (DAYS.rhBase[d] - 55) / 15 - DAYS.wind[d] / 25));
      hourly.relative_humidity_2m.push(Math.round(Math.min(98, DAYS.rhBase[d] + 18 * (1 - heat) - 6)));
      hourly.uv_index.push(r1(DAYS.uv[d] * light ** 1.4));
      hourly.precipitation_probability.push(rainy ? DAYS.pop[d] : Math.round(DAYS.pop[d] * 0.35));
      hourly.precipitation.push(rainy && DAYS.precip[d] ? r1(DAYS.precip[d] / 8) : 0);
      hourly.wind_speed_10m.push(r1(DAYS.wind[d] * (0.45 + 0.55 * heat)));
      hourly.wind_direction_10m.push(Math.round((DAYS.windDir[d] + 25 * Math.sin((h / 24) * Math.PI * 2) + 360) % 360));
      hourly.weather_code.push(rainy ? DAYS.code[d] : DAYS.code[d] > 3 ? 3 : DAYS.code[d]);
      hourly.cloud_cover.push(DAYS.cloud[d]);
      hourly.is_day.push(light > 0 ? 1 : 0);
    }
  }

  const ci = 9; // current hour index on day one
  return {
    latitude: 30.79,
    longitude: 31.0,
    timezone: ZONE,
    timezone_abbreviation: 'EEST',
    utc_offset_seconds: OFFSET,
    current_units: {},
    current: {
      time: DEMO_NOW,
      interval: 900,
      temperature_2m: hourly.temperature_2m[ci],
      apparent_temperature: hourly.apparent_temperature[ci],
      relative_humidity_2m: hourly.relative_humidity_2m[ci],
      wind_speed_10m: hourly.wind_speed_10m[ci],
      wind_direction_10m: hourly.wind_direction_10m[ci],
      weather_code: hourly.weather_code[ci],
      cloud_cover: hourly.cloud_cover[ci],
      is_day: 1,
      precipitation: 0,
    },
    hourly_units: { temperature_2m: '°C', wind_speed_10m: 'km/h', relative_humidity_2m: '%' },
    hourly,
    daily_units: { temperature_2m_max: '°C', precipitation_sum: 'mm' },
    daily,
  };
}
