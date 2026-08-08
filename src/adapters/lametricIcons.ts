const BASE = "https://developer.lametric.com";

export type LametricIcon = {
  id: number;
  code: string;
  title: string;
  category: string | null;
  thumb: string;
  type: "static" | "animated";
};

type CacheEntry = {
  at: number;
  icons: LametricIcon[];
  total: number;
};

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60_000;

function toAbsolute(path: string): string {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function searchLametricIcons(opts: {
  q?: string;
  page?: number;
  count?: number;
}): Promise<{ icons: LametricIcon[]; total: number; page: number }> {
  const page = Math.max(0, opts.page ?? 0);
  const count = Math.min(100, Math.max(1, opts.count ?? 48));
  const q = (opts.q ?? "").trim();
  const cacheKey = `${q}|${page}|${count}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { icons: hit.icons, total: hit.total, page };
  }

  const params = new URLSearchParams({
    page: String(page),
    count: String(count),
    search: q,
  });
  if (!q) {
    params.set("category", "Popular");
  }

  const url = `${BASE}/api/v1/dev/preloadicons?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    throw new Error(`LaMetric icons HTTP ${res.status}`);
  }

  const body = (await res.json()) as {
    icons?: Array<{
      id: number;
      type?: number;
      name?: string;
      category?: string;
      thumbnail?: string;
      thumbnail_image?: string;
    }>;
    count_all?: number;
  };

  const icons: LametricIcon[] = (body.icons ?? []).map((icon) => {
    const animated = icon.type !== 0;
    const prefix = animated ? "a" : "i";
    const thumbPath =
      icon.thumbnail ||
      icon.thumbnail_image ||
      `/content/apps/icon_thumbs/${icon.id}_icon_thumb.${animated ? "gif" : "png"}`;
    return {
      id: icon.id,
      code: `${prefix}${icon.id}`,
      title: icon.name ?? String(icon.id),
      category: icon.category ?? null,
      thumb: toAbsolute(thumbPath),
      type: animated ? "animated" : "static",
    };
  });

  const total = Number(body.count_all ?? icons.length);
  cache.set(cacheKey, { at: Date.now(), icons, total });
  return { icons, total, page };
}
