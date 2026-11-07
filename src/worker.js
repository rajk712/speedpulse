// SpeedPulse API: latency, download, upload and connection info.
// Static files in ./public are served by Workers Assets; only /api/* reaches this code.

const MAX_DOWN_BYTES = 100 * 1024 * 1024;
const DEFAULT_DOWN_BYTES = 25 * 1024 * 1024;
const CHUNK_SIZE = 64 * 1024;

// One random chunk per isolate. Random bytes don't compress, so proxies can't shrink the payload.
let chunk;
function getChunk() {
  if (!chunk) {
    chunk = new Uint8Array(CHUNK_SIZE);
    for (let i = 0; i < CHUNK_SIZE; i += 65536) {
      crypto.getRandomValues(chunk.subarray(i, Math.min(i + 65536, CHUNK_SIZE)));
    }
  }
  return chunk;
}

const NO_CACHE = {
  "Cache-Control": "no-store, no-transform",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Timing-Allow-Origin": "*",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...NO_CACHE, "Content-Type": "application/json" },
  });
}

function download(url) {
  const requested = Number(url.searchParams.get("bytes")) || DEFAULT_DOWN_BYTES;
  const total = Math.min(Math.max(requested, 1), MAX_DOWN_BYTES);
  const data = getChunk();
  let sent = 0;

  const body = new ReadableStream({
    pull(controller) {
      const remaining = total - sent;
      if (remaining <= 0) {
        controller.close();
        return;
      }
      const piece = remaining >= data.length ? data : data.subarray(0, remaining);
      controller.enqueue(piece);
      sent += piece.length;
    },
  });

  return new Response(body, {
    headers: {
      ...NO_CACHE,
      "Content-Type": "application/octet-stream",
      "Content-Length": String(total),
    },
  });
}

async function upload(request) {
  let received = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
    }
  }
  return json({ received });
}

function meta(request) {
  const cf = request.cf || {};
  return json({
    ip: request.headers.get("CF-Connecting-IP") || "",
    isp: cf.asOrganization || "",
    asn: cf.asn || null,
    city: cf.city || "",
    region: cf.region || "",
    country: cf.country || "",
    colo: cf.colo || "",
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: NO_CACHE });
    }

    switch (url.pathname) {
      case "/api/ping":
        return new Response("pong", { headers: { ...NO_CACHE, "Content-Type": "text/plain" } });
      case "/api/down":
        return download(url);
      case "/api/up":
        if (request.method !== "POST") return json({ error: "POST only" }, 405);
        return upload(request);
      case "/api/meta":
        return meta(request);
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
    return env.ASSETS.fetch(request);
  },
};
