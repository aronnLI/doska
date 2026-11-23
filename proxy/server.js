#!/usr/bin/env node
/**
 * Прокси для живых данных: Node.js, без зависимостей.
 *
 *   node server.js
 *   MC_HOST=play.example.com PLAN_URL=https://plan.example.com node server.js
 *
 * Отдаёт GET /status → { online, players: {online, max}, version, tps, plan, ts }
 * Кэш 60 секунд, таймаут источника 3 секунды, при ошибке — null (фронт покажет «—»).
 *
 * За nginx/Cloudflare достаточно: proxy_pass http://127.0.0.1:8787;
 */
const http = require("http");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.MC_HOST || "play.example.com";
const PLAN_URL = (process.env.PLAN_URL || "").replace(/\/+$/, "");
const PLAN_SERVER = process.env.PLAN_SERVER || HOST;
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";
const TIMEOUT_MS = 3000;
const CACHE_MS = 60000;

let cache = { at: 0, body: null };
let inflight = null;

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "mc-status-proxy/1.0" },
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const pick = (value) => {
  if (Array.isArray(value)) {
    const nums = value.filter((v) => typeof v === "number" && Number.isFinite(v));
    return nums.length ? nums[nums.length - 1] : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") return extractTps(value);
  return null;
};

function extractTps(raw) {
  if (!raw || typeof raw !== "object") return null;
  const candidates = [
    raw.numbers && raw.numbers.recentTps,
    raw.tps,
    raw.recentTps,
    raw.server && raw.server.tps,
    raw.numbers && raw.numbers.tps,
  ];
  for (const candidate of candidates) {
    const value = pick(candidate);
    if (value !== null) return Math.max(0, Math.min(20, value));
  }
  return null;
}

async function collect() {
  const [status, planData] = await Promise.all([
    fetchJson(`https://api.mcstatus.io/v2/status/java/${encodeURIComponent(HOST)}`),
    PLAN_URL ? fetchJson(`${PLAN_URL}/v1/serverOverview?server=${encodeURIComponent(PLAN_SERVER)}`) : null,
  ]);
  const tps = extractTps(planData);
  const ok = status && typeof status === "object";
  return {
    online: ok ? status.online === true : null,
    players: {
      online: ok && status.players ? status.players.online ?? null : null,
      max: ok && status.players ? status.players.max ?? null : null,
    },
    version: ok ? (status.version?.name_clean || status.version?.name || null) : null,
    tps,
    plan: tps !== null,
    ts: Date.now(),
  };
}

function statusPayload() {
  if (cache.body && Date.now() - cache.at < CACHE_MS) return Promise.resolve(cache.body);
  if (!inflight) {
    inflight = collect().then((body) => {
      cache = { at: Date.now(), body };
      inflight = null;
      return body;
    });
  }
  return inflight;
}

const server = http.createServer(async (req, res) => {
  const headers = {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    Vary: "Origin",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, headers);
    return res.end();
  }

  if (new URL(req.url, "http://localhost").pathname !== "/status") {
    res.writeHead(404, { ...headers, "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }

  const body = await statusPayload();
  res.writeHead(200, {
    ...headers,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=30",
  });
  res.end(JSON.stringify(body));
});

server.listen(PORT, () => {
  console.log(`Proxy: http://127.0.0.1:${PORT}/status  →  ${HOST}${PLAN_URL ? " + " + PLAN_URL : ""}`);
});
