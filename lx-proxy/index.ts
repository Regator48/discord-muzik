const PORT = 4568;

const XINGHAI_MAIN_API = "https://music-api.gdstudio.xyz/api.php?use_xbridge3=true&loader_name=forest&need_sec_link=1&sec_link_scene=im&theme=light";
const XINGHAI_BACKUP_API = "https://music-dl.sayqz.com/api/";
const SUYIN_QQ_API = "https://oiapi.net/api/QQ_Music";
const SUYIN_QQ_KEY = process.env.OIAPI_KEY || "";
const SUYIN_163_API = "https://oiapi.net/api/Music_163";
const SUYIN_KUWO_API = "https://oiapi.net/api/Kuwo";
const SUYIN_MIGU_API = "https://api.xcvts.cn/api/music/migu";

const QISHUI_API_HTTPS = "https://api.vsaa.cn/api/music.qishui.vip";
const QISHUI_API_HTTP = "http://api.vsaa.cn/api/music.qishui.vip";
const QISHUI_PROXY_API = "https://proxy.qishui.vsaa.cn/qishui/proxy";

const CHANGQING_URL_TEMPLATES: Record<string, string> = {
  tx: "http://175.27.166.236/kgqq/qq.php?type=mp3&id={id}&level={level}",
  wy: "http://175.27.166.236/wy/wy.php?type=mp3&id={id}&level={level}",
  kw: "https://musicapi.haitangw.net/music/kw.php?type=mp3&id={id}&level={level}",
  kg: "https://music.haitangw.cc/kgqq/kg.php?type=mp3&id={id}&level={level}",
  mg: "https://music.haitangw.cc/musicapi/mg.php?type=mp3&id={id}&level={level}",
};

const NIANXIN_URL_TEMPLATES: Record<string, string> = {
  tx: "https://music.nxinxz.com/kgqq/tx.php?id={id}&level={level}&type=mp3",
  wy: "http://music.nxinxz.com/wy.php?id={id}&level={level}&type=mp3",
  kw: "http://music.nxinxz.com/kw.php?id={id}&level={level}&type=mp3",
  kg: "https://music.nxinxz.com/kgqq/kg.php?id={id}&level={level}&type=mp3",
  mg: "http://music.nxinxz.com/mg.php?id={id}&level={level}&type=mp3",
};

const PLATFORM_QUALITIES: Record<string, string[]> = {
  wy: ["24bit", "flac", "320k", "192k", "128k"],
  tx: ["24bit", "flac", "320k", "192k", "128k"],
  kw: ["24bit", "flac", "320k", "192k", "128k"],
  kg: ["24bit", "flac", "320k", "192k", "128k"],
  mg: ["24bit", "flac", "320k", "192k", "128k"],
};

const PLATFORM_TO_XINGHAI: Record<string, string> = { wy: "netease", tx: "tencent", kw: "kuwo", kg: "kugou", mg: "migu" };
const PLATFORM_TO_XINGHAI_BACKUP: Record<string, string> = { wy: "netease", tx: "qq", kw: "kuwo" };
const QUALITY_TO_BR: Record<string, string> = { "128k": "128", "192k": "192", "320k": "320", flac: "740", flac24bit: "999", "24bit": "999" };
const QUALITY_TO_SUYIN_QQ_BR: Record<string, number> = { "128k": 7, "320k": 5, flac: 4, hires: 3, atmos: 2, master: 1, "24bit": 1 };
const QUALITY_TO_KUWO_BR: Record<string, number> = { flac: 1, "320k": 5, "128k": 7, "24bit": 1 };
const QUALITY_PRIORITY = ["flac24bit", "flac", "320k", "192k", "128k"];

const PLATFORM_NAMES: Record<string, string> = { wy: "网易云", tx: "QQ音乐", kw: "酷我", kg: "酷狗", mg: "咪咕" };

const urlCache = new Map<string, { url: string; ts: number }>();
const CACHE_TTL = 21600000;
const CACHE_MAX = 500;

// --- helpers ---

function httpGet(url: string, timeout = 5000): Promise<any> {
  return fetch(url, { signal: AbortSignal.timeout(timeout) })
    .then((r) => r.text())
    .then((t) => {
      try { return JSON.parse(t.trim()); } catch { return t; }
    });
}

function httpPostJson(url: string, body: any, timeout = 10000): Promise<any> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  })
    .then((r) => r.json())
    .catch(() => null);
}

function normalizeKeyword(k: string): string {
  return (k || "").replace(/\(\s*Live\s*\)/gi, "").replace(/\([^)]*\)/g, "").replace(/\s+/g, "").replace(/[^\w\u4e00-\u9fa5]/g, "").trim().toLowerCase();
}

function titleMatch(a: string, b: string): boolean {
  const na = normalizeKeyword(a), nb = normalizeKeyword(b);
  if (!na || !nb) return true;
  return na.includes(nb) || nb.includes(na);
}

function selectQuality(requested: string, supported: string[]): string {
  const r = (requested || "128k").toLowerCase();
  if (supported.includes(r)) return r;
  for (const q of QUALITY_PRIORITY) { if (supported.includes(q)) return q; }
  return supported[0] || "128k";
}

function qualityToNetease(q: string): string {
  const ql = (q || "128k").toLowerCase();
  if (["flac", "flac24bit", "hires", "master", "atmos"].includes(ql)) return "lossless";
  if (["320k", "192k"].includes(ql)) return "exhigh";
  return "standard";
}

function getCacheKey(prefix: string, name: string, singer: string, quality: string): string {
  return `${prefix}_${name}_${singer}_${quality}`;
}

function getCached(key: string): string | null {
  const e = urlCache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts >= CACHE_TTL) { urlCache.delete(key); return null; }
  return e.url;
}

function setCache(key: string, url: string) {
  urlCache.set(key, { url, ts: Date.now() });
  if (urlCache.size > CACHE_MAX) {
    const oldest = urlCache.keys().next().value;
    if (oldest) urlCache.delete(oldest);
  }
}

function buildKeywords(name: string, singer?: string, album?: string): { kw: string; strict: boolean }[] {
  const kws: { kw: string; strict: boolean }[] = [];
  if (name && singer) { const k = normalizeKeyword(name + singer); if (k) kws.push({ kw: k, strict: true }); }
  if (name && album) { const k = normalizeKeyword(name + album); if (k) kws.push({ kw: k, strict: true }); }
  if (name) { const k = normalizeKeyword(name); if (k) kws.push({ kw: k, strict: false }); }
  return kws;
}

// --- Source handlers ---

async function xinghaiMainGetUrl(platform: string, songId: string, quality: string): Promise<string> {
  const source = PLATFORM_TO_XINGHAI[platform];
  if (!source) throw new Error("星海主不支持该平台");
  const q = selectQuality(quality, ["128k", "192k", "320k", "flac", "flac24bit"]);
  const br = QUALITY_TO_BR[q];
  const url = `${XINGHAI_MAIN_API}&types=url&source=${encodeURIComponent(source)}&id=${encodeURIComponent(songId)}&br=${br}`;
  const res = await httpGet(url);
  if (!res?.url) throw new Error(res?.message || "星海主无URL");
  return res.url;
}

async function xinghaiBackupGetUrl(platform: string, songId: string, quality: string): Promise<string> {
  const source = PLATFORM_TO_XINGHAI_BACKUP[platform];
  if (!source) throw new Error("星海备不支持该平台");
  const q = selectQuality(quality, ["128k", "192k", "320k", "flac"]);
  return `${XINGHAI_BACKUP_API}?source=${encodeURIComponent(source)}&id=${encodeURIComponent(songId)}&type=url&br=${encodeURIComponent(q)}`;
}

async function suyinQQGetUrl(songInfo: any, quality: string): Promise<string> {
  const mid = songInfo?.songmid || songInfo?.id;
  if (!mid) throw new Error("溯音QQ缺少songmid");
  const br = QUALITY_TO_SUYIN_QQ_BR[quality] || 7;
  const res = await httpGet(`${SUYIN_QQ_API}?key=${SUYIN_QQ_KEY}&type=json&br=${br}&n=1&mid=${encodeURIComponent(String(mid))}`);
  if (res?.music) return res.music;
  if (res?.url) return res.url;
  if (res?.message) {
    const m = String(res.message).match(/音频链接[：:](.+?)(?:\n|$)/);
    if (m?.[1]) return m[1].trim();
  }
  throw new Error("溯音QQ无URL");
}

async function suyin163GetUrl(songInfo: any): Promise<string> {
  const id = songInfo?.songmid || songInfo?.id;
  if (!id) throw new Error("溯音163缺少id");
  const res = await httpGet(`${SUYIN_163_API}?id=${encodeURIComponent(String(id))}`);
  if (res?.code === 0 && res?.data) {
    const item = Array.isArray(res.data) ? res.data[0] : res.data;
    if (item?.url) return item.url;
  }
  throw new Error("溯音163无URL");
}

async function suyinKuwoGetUrl(songInfo: any, quality: string): Promise<string> {
  if (!songInfo?.name) throw new Error("溯音酷我需要歌名");
  const key = getCacheKey("kw", songInfo.name, songInfo.singer || "", quality);
  const cached = getCached(key);
  if (cached) return cached;
  const q = selectQuality(quality, ["flac", "320k", "128k"]);
  const br = QUALITY_TO_KUWO_BR[q] || 1;
  const searchTerms = songInfo.singer ? `${songInfo.name} ${songInfo.singer}` : songInfo.name;
  const res = await httpGet(`${SUYIN_KUWO_API}?msg=${encodeURIComponent(searchTerms)}&n=3&br=${br}`);
  if (res?.code === 1 && res?.message) {
    // Extract URL from message: "音乐链接：http://..."
    const match = String(res.message).match(/音乐链接[：:](\S+)/);
    if (match?.[1]) {
      // Clean up URL - replace $ with = for query params (kuwo uses $ as separator)
      let url = match[1].replace(/\$/g, "=");
      setCache(key, url);
      return url;
    }
  }
  throw new Error("溯音酷我无URL");
}

async function suyinMiguGetUrl(songInfo: any): Promise<string> {
  if (!songInfo?.name) throw new Error("溯音咪咕需要歌名");
  const key = getCacheKey("mg", songInfo.name, songInfo.singer || "", "");
  const cached = getCached(key);
  if (cached) return cached;
  for (const item of buildKeywords(songInfo.name, songInfo.singer)) {
    const res = await httpGet(`${SUYIN_MIGU_API}?gm=${encodeURIComponent(item.kw)}&n=1&num=1&type=json`);
    if (res?.code === 200 && res?.musicInfo) {
      setCache(key, res.musicInfo);
      return res.musicInfo;
    }
  }
  throw new Error("溯音咪咕无URL");
}

async function changqingGetUrl(platform: string, songInfo: any, quality: string): Promise<string> {
  const tpl = CHANGQING_URL_TEMPLATES[platform];
  if (!tpl) throw new Error("长青不支持该平台");
  const id = songInfo?.hash || songInfo?.songmid || songInfo?.id;
  if (!id) throw new Error("长青缺少songId");
  const level = qualityToNetease(quality);
  return tpl.replace("{id}", encodeURIComponent(String(id))).replace("{level}", level);
}

async function nianxinGetUrl(platform: string, songInfo: any, quality: string): Promise<string> {
  const tpl = NIANXIN_URL_TEMPLATES[platform];
  if (!tpl) throw new Error("念心不支持该平台");
  const id = songInfo?.hash || songInfo?.songmid || songInfo?.id;
  if (!id) throw new Error("念心缺少songId");
  const level = qualityToNetease(quality);
  return tpl.replace("{id}", encodeURIComponent(String(id))).replace("{level}", level);
}

// --- Aggregated URL with fallback ---

async function getUrlWithFallback(platform: string, songInfo: any, quality: string): Promise<string> {
  if (!PLATFORM_QUALITIES[platform]) throw new Error("无效平台");
  const q = selectQuality(quality || "128k", PLATFORM_QUALITIES[platform]);
  const songId = String(songInfo?.hash || songInfo?.songmid || songInfo?.id || "").replace(/^MUSIC_/, "");

  const handlers: { name: string; fn: () => Promise<string> }[] = [];

  // Platform-specific handlers first (most reliable)
  if (platform === "tx") handlers.push({ name: "溯音QQ", fn: () => suyinQQGetUrl(songInfo, q) });
  if (platform === "wy") handlers.push({ name: "溯音163", fn: () => suyin163GetUrl(songInfo) });
  if (platform === "kw") handlers.push({ name: "溯音酷我", fn: () => suyinKuwoGetUrl(songInfo, q) });
  if (platform === "mg") handlers.push({ name: "溯音咪咕", fn: () => suyinMiguGetUrl(songInfo) });

  // Then generic sources
  handlers.push({ name: "星海主", fn: () => xinghaiMainGetUrl(platform, songId, q) });
  handlers.push({ name: "长青", fn: () => changqingGetUrl(platform, songInfo, q) });
  handlers.push({ name: "念心", fn: () => nianxinGetUrl(platform, songInfo, q) });

  // Try first 3 in parallel
  const first3 = handlers.slice(0, 3);
  const results = await Promise.allSettled(first3.map((h) => h.fn()));
  for (const r of results) {
    if (r.status === "fulfilled" && r.value && typeof r.value === "string" && r.value.startsWith("http")) {
      return await resolveRedirect(r.value);
    }
  }

  // Sequential fallback
  for (const h of handlers.slice(3)) {
    try {
      const url = await h.fn();
      if (url && typeof url === "string" && url.startsWith("http")) {
        return await resolveRedirect(url);
      }
    } catch {}
  }

  throw new Error("所有源均失败");
}

// Follow redirects to get actual streaming URL
async function resolveRedirect(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    return res.url || url;
  } catch {
    return url;
  }
}

// --- 汽水VIP search ---

async function qishuiSearch(keyword: string): Promise<any[]> {
  const urls = [QISHUI_API_HTTPS, QISHUI_API_HTTP];
  for (const base of urls) {
    try {
      const url = `${base}?act=search&keywords=${encodeURIComponent(keyword)}&page=1&pagesize=10&type=music`;
      const res = await httpGet(url, 15000);
      const lists = res?.data?.lists;
      if (Array.isArray(lists)) return lists.map((item: any) => ({
        id: String(item.id || ""),
        name: item.name || "未知",
        singer: item.artists || item.singer || "未知",
        album: item.album || "",
        duration: item.duration ? Math.floor(Number(item.duration) / 1000) : 0,
        platform: "qishui",
      }));
    } catch {}
  }
  return [];
}

// --- 溯音酷我搜索 ---

async function suyinKuwoSearch(keyword: string): Promise<any[]> {
  try {
    const res = await httpGet(`${SUYIN_KUWO_API}?msg=${encodeURIComponent(keyword)}&n=10`);
    if (res?.code === 1 && res?.data) {
      const items = Array.isArray(res.data) ? res.data : [res.data];
      return items.map((item: any) => ({
        id: String(item.rid || item.musicrid?.replace("MUSIC_", "") || "").replace(/^MUSIC_/, ""),
        name: item.name || item.song || "未知",
        singer: item.artist || item.singer || "未知",
        album: item.album || "",
        duration: item.duration ? Math.floor(Number(item.duration) / 1000) : 0,
        platform: "kw",
      })).filter((t: any) => t.id);
    }
    // Single result format
    if (res?.data?.rid) {
      return [{
        id: String(res.data.rid).replace(/^MUSIC_/, ""),
        name: res.data.song || res.data.name || "未知",
        singer: res.data.singer || res.data.artist || "未知",
        album: res.data.album || "",
        duration: res.data.duration ? Math.floor(Number(res.data.duration) / 1000) : 0,
        platform: "kw",
      }];
    }
  } catch {}
  return [];
}

// --- 汽水VIP get URL ---

async function qishuiGetUrl(songId: string, quality: string): Promise<string> {
  const q = quality === "flac" || quality === "flac24bit" || quality === "24bit" ? "lossless"
    : quality === "320k" ? "standard" : "low";
  const urls = [QISHUI_API_HTTPS, QISHUI_API_HTTP];
  for (const base of urls) {
    try {
      const res = await httpGet(`${base}?act=song&id=${encodeURIComponent(songId)}&quality=${q}`, 20000);
      const data = Array.isArray(res?.data) ? res.data[0] : res?.data;
      if (data?.url) {
        if (data.ekey) {
          const proxyRes = await httpPostJson(QISHUI_PROXY_API, {
            url: data.url, key: data.ekey, filename: data.filename || "KMusic", ext: data.fileExtension || "aac",
          }, 60000);
          if (proxyRes?.code === 200 && proxyRes?.url) return String(proxyRes.url);
        }
        return String(data.url);
      }
    } catch {}
  }
  throw new Error("汽水VIP无URL");
}

// --- 全平台搜索 (用汽水VIP搜，返回多平台结果) ---

async function searchAllPlatforms(keyword: string): Promise<any[]> {
  // Try 汽水VIP first
  const qishuiResults = await qishuiSearch(keyword);
  if (qishuiResults.length > 0) return qishuiResults;

  // Fallback: Suyin Kuwo search
  const kuwoResults = await suyinKuwoSearch(keyword);
  if (kuwoResults.length > 0) return kuwoResults;

  return [];
}

// --- 网易云歌单 (gdstudio types=playlist) ---

async function xinghaiNeteasePlaylist(playlistId: string): Promise<{ name: string; count: number; items: any[] }> {
  const url = `${XINGHAI_MAIN_API}&types=playlist&id=${encodeURIComponent(playlistId)}`;
  const res = await httpGet(url, 15000);
  const tracks = res?.playlist?.tracks;
  if (!Array.isArray(tracks) || tracks.length === 0) throw new Error("无法获取网易云歌单");
  const items = tracks
    .filter((t: any) => t?.id)
    .map((t: any) => ({
      id: String(t.id),
      name: t.name || "未知",
      singer: (Array.isArray(t.ar) ? t.ar.map((a: any) => a?.name).filter(Boolean).join("/") : "") || "未知",
      album: t.al?.name || "",
      duration: t.dt ? Math.floor(Number(t.dt) / 1000) : 0,
    }));
  return { name: res.playlist.name || "", count: res.playlist.trackCount || items.length, items };
}

// --- HTTP Server ---

const server = Bun.serve({
  port: PORT,
  fetch: async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;

  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // GET /search?q=...&source=auto
    if (path === "/search") {
      const q = url.searchParams.get("q") || "";
      if (!q) return Response.json({ error: "missing q" }, { headers: corsHeaders, status: 400 });
      const results = await searchAllPlatforms(q);
      return Response.json({ tracks: results }, { headers: corsHeaders });
    }

    // GET /wy/playlist?id=9101955201
    if (path === "/wy/playlist") {
      const id = url.searchParams.get("id") || "";
      if (!id) return Response.json({ error: "missing id" }, { headers: corsHeaders, status: 400 });
      try {
        return Response.json(await xinghaiNeteasePlaylist(id), { headers: corsHeaders });
      } catch (e: any) {
        return Response.json({ error: e?.message || "playlist fetch failed" }, { headers: corsHeaders, status: 404 });
      }
    }

    // GET /url?source=tx&id=xxx&quality=320k&name=...&singer=...
    if (path === "/url") {
      const source = url.searchParams.get("source") || "tx";
      const id = url.searchParams.get("id") || "";
      const quality = url.searchParams.get("quality") || "320k";
      const name = url.searchParams.get("name") || "";
      const singer = url.searchParams.get("singer") || "";

      if (!id && !name) return Response.json({ error: "missing id or name" }, { headers: corsHeaders, status: 400 });

      // Try 汽水VIP first if we have an ID
      if (id && source === "qishui") {
        try {
          const streamUrl = await qishuiGetUrl(id, quality);
          return Response.json({ url: streamUrl, source: "qishui" }, { headers: corsHeaders });
        } catch {}
      }

      // Try aggregated sources
      const songInfo = { id, hash: id, songmid: id, name, singer };
      try {
        const streamUrl = await getUrlWithFallback(source, songInfo, quality);
        return Response.json({ url: streamUrl, source }, { headers: corsHeaders });
      } catch (e: any) {
        // Last resort: try all platforms
        for (const plat of ["wy", "tx", "kw", "kg", "mg"]) {
          if (plat === source) continue;
          try {
            const streamUrl = await getUrlWithFallback(plat, songInfo, quality);
            return Response.json({ url: streamUrl, source: plat }, { headers: corsHeaders });
          } catch {}
        }
        return Response.json({ error: e?.message || "all sources failed" }, { headers: corsHeaders, status: 404 });
      }
    }

    // GET /health
    if (path === "/health") {
      return Response.json({ status: "ok", uptime: Date.now() }, { headers: corsHeaders });
    }

    return Response.json({ error: "not found" }, { headers: corsHeaders, status: 404 });
  } catch (e: any) {
    return Response.json({ error: e?.message || "internal error" }, { headers: corsHeaders, status: 500 });
  }
}});

console.log(`LX Proxy listening on port ${PORT}`);
