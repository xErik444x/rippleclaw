import { spawn } from "child_process";
import type { Config } from "../core/config";
import type { Tool } from "../providers/base";

type GeoResult = { name: string; country?: string; admin1?: string; latitude: number; longitude: number };

async function geocodeOpenMeteo(query: string, count = 1): Promise<GeoResult[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query);
  url.searchParams.set("count", String(Math.min(5, Math.max(1, count))));
  url.searchParams.set("language", "es");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo geocoding error ${res.status}`);
  const data = (await res.json()) as {
    results?: { name: string; country?: string; admin1?: string; latitude: number; longitude: number }[];
  };
  return (data.results || []).map((r) => ({
    name: r.name,
    country: r.country,
    admin1: r.admin1,
    latitude: r.latitude,
    longitude: r.longitude
  }));
}

async function fetchOpenMeteo(lat: number, lon: number) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("current_weather", "true");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_sum");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo forecast error ${res.status}`);
  return (await res.json()) as {
    current_weather?: { temperature: number; windspeed: number; weathercode: number; time: string };
    daily?: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_sum: number[] };
    timezone?: string;
  };
}

function weatherCodeToText(code: number): string {
  const map: Record<number, string> = {
    0: "Despejado",
    1: "Mayormente despejado",
    2: "Parcialmente nublado",
    3: "Nublado",
    45: "Niebla",
    48: "Niebla con escarcha",
    51: "Llovizna leve",
    53: "Llovizna moderada",
    55: "Llovizna intensa",
    61: "Lluvia leve",
    63: "Lluvia moderada",
    65: "Lluvia intensa",
    71: "Nieve leve",
    73: "Nieve moderada",
    75: "Nieve intensa",
    80: "Chubascos leves",
    81: "Chubascos moderados",
    82: "Chubascos intensos",
    95: "Tormenta",
    96: "Tormenta con granizo leve",
    99: "Tormenta con granizo fuerte"
  };
  return map[code] || `Código ${code}`;
}

function encodeWttrLocation(loc: string): string {
  return encodeURIComponent(loc.trim()).replace(/%20/g, "+");
}

async function fetchWttr(location: string): Promise<string> {
  const loc = encodeWttrLocation(location);
  const url = `https://wttr.in/${loc}?format=%l:+%c+%t+%h+%w&m`;
  const res = await fetch(url, { headers: { "User-Agent": "RippleClaw/0.1.0" } });
  if (!res.ok) throw new Error(`wttr.in error ${res.status}`);
  const text = (await res.text()).trim();
  if (!text) throw new Error("wttr.in empty response");
  return text;
}

async function fetchWttrViaCurl(location: string): Promise<string> {
  const loc = encodeWttrLocation(location);
  const url = `https://wttr.in/${loc}?format=%l:+%c+%t+%h+%w&m`;
  const maxBuffer = 64 * 1024;
  const timeoutMs = 8000;

  return new Promise<string>((resolveOutput) => {
    const child = spawn("curl", ["-s", url], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let exceeded = false;

    const onData = (chunk: Buffer, target: "stdout" | "stderr") => {
      const text = chunk.toString("utf-8");
      if (target === "stdout") stdout += text;
      else stderr += text;
      if (stdout.length + stderr.length > maxBuffer) {
        exceeded = true;
        child.kill();
      }
    };

    const timeout = setTimeout(() => {
      child.kill();
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => onData(chunk as Buffer, "stdout"));
    child.stderr?.on("data", (chunk) => onData(chunk as Buffer, "stderr"));

    child.on("error", (err) => {
      clearTimeout(timeout);
      resolveOutput(`Error: ${err.message}`);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (exceeded) {
        resolveOutput("Error: curl output exceeded max buffer");
        return;
      }
      const out = stdout.trim();
      if (out) {
        resolveOutput(out);
        return;
      }
      resolveOutput(stderr.trim() || `(exit code: ${code ?? 0})`);
    });
  });
}

export function createWeatherTool(config: Config) {
  return {
    definition: {
      name: "weather",
      description: "Get current weather and today's forecast for a location.",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "City, region, country" }
        },
        required: ["location"]
      }
    } satisfies Tool,

    async execute(args: { location: string }): Promise<string> {
      if (!config.tools.weather?.enabled) {
        return "Error: weather tool is disabled in config.tools.weather.enabled";
      }
      if (!args || typeof args.location !== "string" || !args.location.trim()) {
        return 'Error: "location" is required';
      }

      try {
        const wttr = await fetchWttr(args.location);
        return wttr;
      } catch (err) {
        const msg = String(err);
        if (!/fetch failed|ECONN|ENOTFOUND|timeout/i.test(msg)) {
          // Still try Open-Meteo if wttr returns a non-network error
        }
      }

      try {
        const wttrCurl = await fetchWttrViaCurl(args.location);
        if (wttrCurl && !/^Error:/i.test(wttrCurl)) return wttrCurl;
      } catch {
        // ignore and continue fallback
      }

      const places = await geocodeOpenMeteo(args.location, 1);
      if (!places.length) return "No se encontró la ubicación.";
      const place = places[0];
      const data = await fetchOpenMeteo(place.latitude, place.longitude);

      const now = data.current_weather;
      const todayIdx = data.daily?.time?.[0] ? 0 : -1;
      const max = todayIdx >= 0 ? data.daily!.temperature_2m_max[todayIdx] : undefined;
      const min = todayIdx >= 0 ? data.daily!.temperature_2m_min[todayIdx] : undefined;
      const rain = todayIdx >= 0 ? data.daily!.precipitation_sum[todayIdx] : undefined;

      const placeLabel = [place.name, place.admin1, place.country].filter(Boolean).join(", ");
      const lines: string[] = [];
      lines.push(`Clima en ${placeLabel}`);
      if (now) {
        lines.push(
          `Ahora: ${Math.round(now.temperature)}°C, ${weatherCodeToText(now.weathercode)}, viento ${Math.round(
            now.windspeed
          )} km/h`
        );
      }
      if (max !== undefined && min !== undefined) {
        const rainText = rain !== undefined ? `, precipitación ${rain} mm` : "";
        lines.push(`Hoy: mín ${Math.round(min)}°C / máx ${Math.round(max)}°C${rainText}`);
      }
      if (data.timezone) lines.push(`Zona horaria: ${data.timezone}`);

      return lines.join("\n");
    }
  };
}
