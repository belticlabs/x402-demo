/**
 * Weather and geocoding helpers used by chat and paid API routes.
 */

import { expandLocationAlias, normalizeLocationInput } from '@/lib/location';

export interface ResolvedLocation {
  query: string;
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
}

const WEATHER_CODES: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

function buildLocationLabel(raw: {
  name?: string;
  admin1?: string;
  country?: string;
}): string {
  return [raw.name, raw.admin1, raw.country].filter(Boolean).join(', ');
}

function buildLocationQueryCandidates(query: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const push = (value: string | null | undefined) => {
    if (!value) return;
    const normalized = value.trim();
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(normalized);
  };

  push(query);
  const normalized = normalizeLocationInput(query);
  push(normalized);
  if (normalized) {
    push(expandLocationAlias(normalized));
  }

  // Open-Meteo geocoding returns 0 results for "City, State, US" but succeeds for "City".
  // Add the city-only part as a fallback when the query has comma-separated segments.
  const firstSegment = query.split(',')[0]?.trim();
  push(firstSegment);

  return candidates;
}

export async function resolveLocation(query: string): Promise<ResolvedLocation> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error('Location is required');
  }

  const candidates = buildLocationQueryCandidates(trimmed);

  for (const candidate of candidates) {
    const params = new URLSearchParams({
      name: candidate,
      count: '1',
      language: 'en',
      format: 'json',
    });

    const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Geocoding failed (${response.status})`);
    }

    const data = await response.json();
    const first = data?.results?.[0] as
      | { latitude: number; longitude: number; name?: string; admin1?: string; country?: string }
      | undefined;

    if (!first) {
      continue;
    }

    return {
      query: trimmed,
      name: buildLocationLabel(first) || candidate,
      latitude: first.latitude,
      longitude: first.longitude,
      country: first.country,
      admin1: first.admin1,
    };
  }

  throw new Error(`No location match found for "${trimmed}"`);
}

export async function fetchWeatherByQuery(
  query: string,
  detailed: boolean
): Promise<Record<string, unknown>> {
  let resolved: ResolvedLocation;
  try {
    resolved = await resolveLocation(query);
  } catch (error) {
    return {
      location: query,
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unable to resolve location',
    };
  }

  const params = new URLSearchParams({
    latitude: resolved.latitude.toString(),
    longitude: resolved.longitude.toString(),
    current: detailed
      ? 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure'
      : 'temperature_2m,weather_code',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: 'auto',
  });

  if (detailed) {
    params.append('daily', 'temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max');
    params.append('forecast_days', '5');
  }

  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Open-Meteo API error: ${response.status}`);
    }

    const data = await response.json();
    const weatherCode = data.current?.weather_code ?? 0;

    const result: Record<string, unknown> = {
      location: resolved.name,
      input: resolved.query,
      timestamp: new Date().toISOString(),
      temperature: Math.round(data.current?.temperature_2m ?? 0),
      conditions: WEATHER_CODES[weatherCode] || 'Unknown',
      unit: 'fahrenheit',
      coordinates: {
        latitude: resolved.latitude,
        longitude: resolved.longitude,
      },
    };

    if (detailed && data.current) {
      result.humidity = Math.round(data.current.relative_humidity_2m ?? 0);
      result.apparentTemperature = Math.round(data.current.apparent_temperature ?? 0);
      result.windSpeed = Math.round(data.current.wind_speed_10m ?? 0);
      result.windDirection = data.current.wind_direction_10m ?? 0;
      result.pressure = Math.round(data.current.surface_pressure ?? 0);

      if (data.daily?.time) {
        result.forecast = data.daily.time.map((date: string, i: number) => ({
          date,
          high: Math.round(data.daily.temperature_2m_max[i] ?? 0),
          low: Math.round(data.daily.temperature_2m_min[i] ?? 0),
          conditions: WEATHER_CODES[data.daily.weather_code[i]] || 'Unknown',
          precipitationChance: data.daily.precipitation_probability_max[i] ?? 0,
        }));
      }
    }

    return result;
  } catch (error) {
    console.error('[weather] weather fetch failed:', error);
    return {
      location: resolved.name,
      input: resolved.query,
      timestamp: new Date().toISOString(),
      error: 'Weather API temporarily unavailable',
    };
  }
}
