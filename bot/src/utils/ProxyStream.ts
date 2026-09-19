import type { SearchResult, Track } from "lavalink-client";

export const proxyUrl = process.env.YTDLP_PROXY || "http://127.0.0.1:4567";
export const YT_VIDEO_RE =
	/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

export interface ProxyEntry {
	title: string;
	pageUrl: string;
	duration?: number;
	author?: string;
	artworkUrl?: string;
	abr?: number;
}

export interface ProxyResolved extends ProxyEntry {
	url: string;
	abr?: number;
}

export interface SpotifyItem {
	title: string;
	artists?: string;
	query?: string;
}

export interface PendingPlaylist {
	type: "youtube" | "spotify";
	items: Array<{ title: string; pageUrl?: string; query?: string; duration?: number; author?: string }>;
	loaded: number;
	loading: boolean;
}

export async function proxyResolve(target: string): Promise<ProxyResolved | null> {
	try {
		const res = await fetch(`${proxyUrl}/resolve?url=${encodeURIComponent(target)}`, {
			signal: AbortSignal.timeout(25000),
		});
		if (!res.ok) return null;
		const data = (await res.json()) as ProxyResolved;
		return data && data.pageUrl ? data : null;
	} catch {
		return null;
	}
}

export async function proxyFetch<T>(path: string, params: Record<string, string>): Promise<T | null> {
	try {
		const qs = new URLSearchParams(params).toString();
		console.log("[ProxyStream] proxyFetch:", path, qs);
		const res = await fetch(`${proxyUrl}/${path}?${qs}`, { signal: AbortSignal.timeout(70000) });
		console.log("[ProxyStream] proxyFetch: status", res.status);
		if (!res.ok) return null;
		const data = (await res.json()) as T;
		console.log("[ProxyStream] proxyFetch: got data, items:", Array.isArray(data?.items) ? data.items.length : (data?.results?.length ?? "no items"));
		return data;
	} catch (e) {
		console.error("[ProxyStream] proxyFetch error:", e.message);
		return null;
	}
}

export async function loadProxyTrack(
	player: any,
	user: { id: string },
	entry: ProxyEntry,
): Promise<Track | null> {
	try {
		// Use ytdlp-proxy's /resolve endpoint to get the direct YouTube streaming URL
		// Then give Lavalink the direct URL (bypasses our slow proxy, uses YouTube's fast CDN)
		const resolveUrl = `${proxyUrl}/resolve?url=${encodeURIComponent(entry.pageUrl)}`;
		console.log("[ProxyStream] loadProxyTrack: resolving direct URL for", entry.pageUrl);
		const res = await fetch(resolveUrl, { signal: AbortSignal.timeout(30000) });
		if (!res.ok) {
			console.log("[ProxyStream] loadProxyTrack: resolve failed, status:", res.status);
			return null;
		}
		const data = await res.json() as { url: string; title: string; duration: number; abr?: number };
		if (!data?.url) {
			console.log("[ProxyStream] loadProxyTrack: no direct URL returned");
			return null;
		}
		console.log("[ProxyStream] loadProxyTrack: got direct URL, loading via Lavalink");
		const node = player.node;
		const auth = node.options.authorization;
		const loadRes = await fetch(
			`http://${node.options.host}:${node.options.port}/v4/loadtracks?identifier=${encodeURIComponent(data.url)}&source=http`,
			{ headers: { Authorization: auth } }
		);
		const loadData = await loadRes.json();
		console.log("[ProxyStream] loadProxyTrack: direct URL loadType:", loadData?.loadType, "tracks:", loadData?.data ? 1 : 0);
		if (!loadData || loadData.loadType !== "track" || !loadData.data) {
			console.log("[ProxyStream] loadProxyTrack: no tracks returned, loadType:", loadData?.loadType, "data:", loadData);
			return null;
		}
		const trackData = loadData.data;
		console.log("[ProxyStream] loadProxyTrack: got track, length:", trackData.info?.length, "isStream:", trackData.info?.isStream, "title:", trackData.info?.title);
		const videoId = YT_VIDEO_RE.exec(entry.pageUrl)?.[1] ?? "";
		// Convert Lavalink track data to Track object
		// NOTE: lavalink-client's Track class expects top-level `requester` (used by
		// TrackStart event for "Requested by" display). Missing it throws silently.
		const track: Track = {
			encoded: trackData.encoded,
			info: {
				identifier: videoId,
				isSeekable: trackData.info.isSeekable,
				author: entry.author || "YouTube",
				length: trackData.info.length,
				duration: trackData.info.length,
				isStream: false,
				position: 0,
				title: entry.title,
				uri: entry.pageUrl,
				sourceName: "youtube",
				artworkUrl: entry.artworkUrl || (videoId ? `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg` : undefined),
				isrc: null,
			},
			pluginInfo: trackData.pluginInfo || {},
			requester: user,
			userData: { requester: user },
		} as Track;
		(track.info as any).abr = entry.abr || data.abr;
		return track;
	} catch (e) {
		console.error("[ProxyStream] loadProxyTrack error:", e.message, e.stack);
		return null;
	}
}

export function qualityLine(abr?: number): string {
	return `\n\`MP3 • 128 kbps${abr ? ` (source ${abr} kbps)` : ""}\``;
}

export async function mapLimit<T, R>(
	items: T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R | null>,
): Promise<(R | null)[]> {
	const results: (R | null)[] = new Array(items.length);
	let cursor = 0;
	async function worker(): Promise<void> {
		while (cursor < items.length) {
			const index = cursor++;
			try {
				results[index] = await fn(items[index], index);
			} catch {
				results[index] = null;
			}
		}
	}
	const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
	await Promise.all(workers);
	return results;
}