/**
 * Прокси для живых данных: Cloudflare Worker.
 *
 * Зачем: mcstatus.io CORS открыт, но TPS из Plan API — нет, и любой внешний
 * сервис лучше не дёргать из браузера напрямую. Worker отдаёт один адрес
 * /status, кэш 60 секунд, ответ за 3 секунды или «нет данных».
 *
 * Деплой: Cloudflare Dashboard → Workers → Create → вставить этот файл.
 * Настройки (Settings → Variables):
 *   MC_HOST       play.example.com        IP или домен Java-сервера
 *   PLAN_URL      https://plan.example.com  адрес Plan (без /v1/serverOverview)
 *   PLAN_SERVER   название сервера в Plan (если план один — можно оставить пустым)
 *   ALLOW_ORIGIN  https://ваш-сайт.ру     или * на время настройки
 *
 * Ответ: { online, players: {online, max}, version, tps, plan: bool, ts }
 * tps = null означает «данных нет» — фронтенд покажет «—», а не выдуманное число.
 */

const TIMEOUT_MS = 3000;
const CACHE_SECONDS = 60;

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "mc-status-proxy/1.0" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** TPS зависит от версии Plan: numbers.recentTps, tps или nested performance. */
function extractTps(raw) {
  if (!raw || typeof raw !== "object") return null;
  const pick = (value) => {
    if (Array.isArray(value)) {
      const nums = value.filter((v) => typeof v === "number" && Number.isFinite(v));
      return nums.length ? nums[nums.length - 1] : null;
    }
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value && typeof value === "object") return extractTps(value);
    return null;
  };
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

async function collectStatus(env) {
  const host = String(env.MC_HOST || "").trim();
  const plan = String(env.PLAN_URL || "").replace(/\/+$/, "");
  const planServer = String(env.PLAN_SERVER || "").trim();

  const [status, planData] = await Promise.all([
    host ? fetchJson(`https://api.mcstatus.io/v2/status/java/${encodeURIComponent(host)}`) : null,
    plan ? fetchJson(`${plan}/v1/serverOverview?server=${encodeURIComponent(planServer || host)}`) : null,
  ]);

  const tps = extractTps(planData);
  const hasStatus = status && typeof status === "object";

  return {
    online: hasStatus ? status.online === true : null,
    players: {
      online: hasStatus && status.players ? status.players.online ?? null : null,
      max: hasStatus && status.players ? status.players.max ?? null : null,
    },
    version: hasStatus ? (status.version?.name_clean || status.version?.name || null) : null,
    tps,
    plan: tps !== null,
    ts: Date.now(),
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = env.ALLOW_ORIGIN || "*";
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname !== "/status") return new Response("Not found", { status: 404, headers: cors });

    const cache = caches.default;
    const key = new Request(url.origin + "/status-cache", { method: "GET" });
    let cached = await cache.match(key);

    if (!cached) {
      const body = await collectStatus(env);
      cached = new Response(JSON.stringify(body), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
        },
      });
      ctx.waitUntil(cache.put(key, cached.clone()));
    }

    return new Response(cached.body, {
      status: cached.status,
      headers: { ...Object.fromEntries(cached.headers), ...cors, "Cache-Control": "public, max-age=30" },
    });
  },
};
