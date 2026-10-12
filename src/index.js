
const MAX_HTML_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 5;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function decodeEntities(value = "") {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCodePoint(Number(n))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16))
    );
}

function attrs(tag) {
  const result = {};
  const body = tag.replace(/^<[^\s/>]+|\/?>$/g, "");
  const re =
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

  for (const match of body.matchAll(re)) {
    result[match[1].toLowerCase()] =
      decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }

  return result;
}

function parseMetadata(html, requestedUrl) {
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1]
    ?? html.slice(0, 200_000);

  const title =
    decodeEntities(
      head.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]
        ?.replace(/<[^>]*>/g, "")
        ?.trim() ?? ""
    );

  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)]
    .map(([tag]) => attrs(tag));

  const links = [...head.matchAll(/<link\b[^>]*>/gi)]
    .map(([tag]) => attrs(tag));

  const meta = (predicate) =>
    metas.find(predicate)?.content?.trim() ?? "";

  const desc =
    meta((m) => m.property?.toLowerCase() === "og:description") ||
    meta((m) => m.name?.toLowerCase() === "description");

  const iconLink =
    links.find((l) => l.rel?.toLowerCase().split(/\s+/).includes("apple-touch-icon")) ||
    links.find((l) => l.rel?.toLowerCase().split(/\s+/).includes("icon"));

  const iconValue =
    iconLink?.href ||
    meta((m) => m.property?.toLowerCase() === "og:image") ||
    meta((m) => m.name?.toLowerCase() === "twitter:image");

  let icon = "";

  if (iconValue && !iconValue.startsWith("data:")) {
    try {
      icon = new URL(iconValue, requestedUrl).href;
    } catch {
      icon = "";
    }
  }

  const data = { url: requestedUrl, title, desc };
  if (icon) data.icon = icon;

  return data;
}

function isBlockedHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "::" ||
    host === "::1" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80:")
  ) {
    return true;
  }

  // Reject IPv4 literals that are not public addresses.
  const parts = host.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
    const ip = parts.map(Number);
    const [a, b] = ip;

    if (
      ip.some((n) => n > 255) ||
      a === 0 || a === 10 || a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    ) return true;
  }

  return false;
}

function validateTarget(value) {
  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid URL");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are allowed");
  }

  if (url.username || url.password || isBlockedHost(url.hostname)) {
    throw new Error("Target host is not allowed");
  }

  return url;
}

async function readLimited(response) {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value.byteLength;

    if (total > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new Error("HTML response too large");
    }

    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
}

async function fetchHtml(inputUrl) {
  let url = validateTarget(inputUrl);

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const response = await fetch(url.href, {
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent": "SiteInfoBot/1.0",
        "Accept": "text/html,application/xhtml+xml",
      },
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("Location");
      if (!location || i === MAX_REDIRECTS) {
        throw new Error("Too many redirects");
      }

      url = validateTarget(new URL(location, url).href);
      continue;
    }

    if (!response.ok) {
      throw new Error(`Target returned HTTP ${response.status}`);
    }

    const type = response.headers.get("Content-Type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(type)) {
      throw new Error("Target did not return HTML");
    }

    return {
      html: await readLimited(response),
      finalUrl: url.href,
    };
  }

  throw new Error("Too many redirects");
}

export default {
  async fetch(request, env) {
    const requestUrl = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405);
    }

    const allowedHosts = (env.HOSTS || "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);

    const referer = request.headers.get("Referer");

    if (!referer && env.ALLOW_EMPTY_REFERER !== "true") {
      return json({ error: "Missing Referer" }, 403);
    }

    if (referer) {
      let refererHost;

      try {
        refererHost = new URL(referer).hostname.toLowerCase();
      } catch {
        return json({ error: "Invalid Referer" }, 403);
      }

      if (!allowedHosts.includes(refererHost)) {
        return json({
          title: "请自部署该服务",
          desc: "https://github.com/jhlzlove/site-info-worker",
        }, 403);
      }
    }

    const target = requestUrl.searchParams.get("url");

    if (!target) {
      return json({ error: "Missing url parameter" }, 400);
    }

    try {
      const { html, finalUrl } = await fetchHtml(target);
      return json(parseMetadata(html, finalUrl));
    } catch (error) {
      return json({
        error: error.message || "Failed to fetch site metadata",
      }, 502);
    }
  },
};
