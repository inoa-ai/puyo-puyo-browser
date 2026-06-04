const ALLOWED_ORIGINS = new Set([
  "https://inoa-ai.github.io",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
]);

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") ?? "";
    const corsHeaders = getCorsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/leaderboard" && request.method === "GET") {
        return withCors(await getLeaderboard(env), corsHeaders);
      }

      if (url.pathname === "/scores" && request.method === "POST") {
        return withCors(await submitScore(request, env), corsHeaders);
      }

      return json({ error: "not_found" }, 404, corsHeaders);
    } catch (error) {
      return json({ error: "server_error" }, 500, corsHeaders);
    }
  },
};

async function getLeaderboard(env) {
  const { results } = await env.DB.prepare(
    "SELECT name, score, created_at FROM scores ORDER BY score DESC, created_at ASC LIMIT 10",
  ).all();

  return json({ scores: results });
}

async function submitScore(request, env) {
  const body = await request.json().catch(() => null);
  const name = normalizeName(body?.name);
  const score = normalizeScore(body?.score);

  if (!name || score === null) {
    return json({ error: "invalid_score" }, 400);
  }

  await env.DB.prepare("INSERT INTO scores (name, score) VALUES (?, ?)").bind(name, score).run();
  return getLeaderboard(env);
}

function normalizeName(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 16);
}

function normalizeScore(value) {
  const score = Number(value);
  if (!Number.isInteger(score) || score <= 0 || score > 9999999) return null;
  return score;
}

function getCorsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://inoa-ai.github.io";
  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "vary": "Origin",
  };
}

function withCors(response, corsHeaders) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}
