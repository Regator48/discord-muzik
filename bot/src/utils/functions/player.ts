/** biome-ignore-all lint/style/noNonNullAssertion: <> */
import type { Player, Track } from "lavalink-client";
import type { Requester } from "../../types";

/**
 * Transforms a requester into a standardized requester object.
 *
 * @param {any} requester The requester to transform. Can be a string, a user, or an object with
 *                        the keys `id`, `username`, and `avatarURL`.
 * @returns {Requester} The transformed requester object.
 */
export const requesterTransformer = (requester: any): Requester => {
	// if it's already the transformed requester
	if (typeof requester === "object" && "avatar" in requester && Object.keys(requester).length === 3)
		return requester as Requester;
	// if it's still a string
	if (typeof requester === "object" && "displayAvatarURL" in requester) {
		// it's a user
		return {
			id: requester.id,
			username: requester.username,
			avatarURL: requester.displayAvatarURL({ extension: "png" }),
			discriminator: requester.discriminator,
		};
	}
	return { id: requester?.toString() || "unknown", username: "unknown" };
};

/**
 * Function that will be called when the autoplay feature is enabled and the queue
 * is empty. It will search for tracks based on the last played track and add them
 * to the queue.
 *
 * @param {Player} player The player instance.
 * @param {Track} lastTrack The last played track.
 * @returns {Promise<void>} A promise that resolves when the function is done.
 */
export async function autoPlayFunction(player: Player, lastTrack?: Track): Promise<void> {
	if (!player.get("autoplay")) return;
	if (!lastTrack) return;

	if (lastTrack.info.sourceName === "spotify") {
		const filtered = player.queue.previous
			.filter((v) => v.info.sourceName === "spotify")
			.slice(0, 5);
		const ids = filtered
			.map(
				(v) =>
					v.info.identifier ||
					v.info.uri?.split("/")?.reverse()?.[0] ||
					v.info.uri?.split("/")?.reverse()?.[1],
			)
			.filter(Boolean);
		if (ids.length >= 2) {
			const res = await player
				.search(
					{
						query: `seed_tracks=${ids.join(",")}`, //`seed_artists=${artistIds.join(",")}&seed_genres=${genre.join(",")}&seed_tracks=${trackIds.join(",")}`;
						source: "sprec",
					},
					lastTrack.requester,
				)
				.then((response: any) => {
					response.tracks = response.tracks.filter(
						(v: { info: { identifier: string } }) =>
							v.info.identifier !== lastTrack.info.identifier,
					); // remove the lastPlayed track if it's in there..
					return response;
				})
				logger.warn("Error caught and ignored");
			if (res && res.tracks.length > 0)
				await player.queue.add(
					res.tracks.slice(0, 5).map((track: { pluginInfo: { clientData: any } }) => {
						// transform the track plugininfo so you can figure out if the track is from autoplay or not.
						track.pluginInfo.clientData = {
							...(track.pluginInfo.clientData || {}),
							fromAutoplay: true,
						};
						return track;
					}),
				);
		}
		return;
	}
	if (lastTrack.info.sourceName === "youtube" || lastTrack.info.sourceName === "youtubemusic") {
		const res = await player
			.search(
				{
					query: `https://www.youtube.com/watch?v=${lastTrack.info.identifier}&list=RD${lastTrack.info.identifier}`,
					source: "youtube",
				},
				lastTrack.requester,
			)
			.then((response: any) => {
				response.tracks = response.tracks.filter(
					(v: { info: { identifier: string } }) => v.info.identifier !== lastTrack.info.identifier,
				); // remove the lastPlayed track if it's in there..
				return response;
			})
			logger.warn("Error caught and ignored");
		if (res && res.tracks.length > 0)
			await player.queue.add(
				res.tracks.slice(0, 5).map((track: { pluginInfo: { clientData: any } }) => {
					// transform the track plugininfo so you can figure out if the track is from autoplay or not.
					track.pluginInfo.clientData = {
						...(track.pluginInfo.clientData || {}),
						fromAutoplay: true,
					};
					return track;
				}),
			);
		return;
	}
	if (lastTrack.info.sourceName === "http") {
		// LX Chinese music autoplay: suggest the same artist's song via the LX proxy
		const lxTrack = player.get<{ name: string; singer: string }>("lxTrack");
		if (!lxTrack) return;
		const LX_PROXY_URL = process.env.LX_PROXY_URL || "http://127.0.0.1:4568";
		try {
			const searchUrl = `${LX_PROXY_URL}/search?q=${encodeURIComponent(lxTrack.singer)}`;
			const res = await fetch(searchUrl, { signal: AbortSignal.timeout(12000) });
			const data: any = await res.json();
			const tracks: any[] = data?.tracks || [];
			const pick =
				tracks.find((t) => t.singer === lxTrack.singer && t.name !== lxTrack.name) ||
				tracks.find((t) => t.singer === lxTrack.singer) ||
				tracks[0];
			if (!pick) return;

			const platformMap: Record<string, string> = { "QQ": "tx", "酷我": "kw", "网易云": "wy", "酷狗": "kg", "咪咕": "mg" };
			const searchPlatform = platformMap[pick.platform] || pick.platform || "kw";
			const platforms = [searchPlatform, ...["wy", "tx", "kg", "kw", "mg"].filter((p) => p !== searchPlatform)];
			let streamUrl: string | null = null;
			for (const plat of platforms) {
				try {
					const urlParams = new URLSearchParams({
						source: plat,
						id: pick.id || "",
						quality: "320k",
						name: pick.name || "",
						singer: pick.singer || "",
					});
					const urlRes = await fetch(`${LX_PROXY_URL}/url?${urlParams}`, {
						signal: AbortSignal.timeout(15000),
					});
					const urlData: any = await urlRes.json();
					if (urlData?.url) {
						streamUrl = urlData.url;
						break;
					}
				} catch {}
			}
			if (!streamUrl) return;

			const searchResult = await player.search({ query: streamUrl }, lastTrack.requester);
			if (searchResult && Array.isArray(searchResult.tracks) && searchResult.tracks.length > 0) {
				const track = searchResult.tracks[0];
				// Stamp real Chinese metadata — HTTP source reports "Unknown title"
				track.info.title = pick.name;
				track.info.author = pick.singer;
				track.pluginInfo = track.pluginInfo || {};
				track.pluginInfo.clientData = {
					...(track.pluginInfo.clientData || {}),
					fromAutoplay: true,
					lxInfo: { name: pick.name, singer: pick.singer },
				};
				await player.queue.add(track);
			}
		} catch {
			// ignore autoplay failures
		}
		return;
	}
	if (lastTrack.info.sourceName === "jiosaavn") {
		const res = await player.search(
			{ query: `jsrec:${lastTrack.info.identifier}`, source: "jsrec" },
			lastTrack.requester,
		);
		if (res.tracks.length > 0) {
			const track = res.tracks.filter((v) => v.info.identifier !== lastTrack.info.identifier)[0];
			if (track) await player.queue.add(track);
		}
	}
	return;
}

/**
 * Extracts a requester id string from a track requester (object or primitive).
 *
 * @param {unknown} requester The requester attached to a track.
 * @returns {string} The requester id.
 */
export function getRequesterId(requester: unknown): string {
	if (typeof requester === "object" && requester && "id" in requester) {
		return (requester as { id: string }).id;
	}
	return String(requester);
}

/**
 * Applies fair play to the player's queue by ensuring that tracks from different requesters are played in a round-robin fashion.
 * @param {Player} player The player instance.
 * @returns {Promise<Track[]>} A promise that resolves to the fair queue of tracks.
 */
export async function applyFairPlayToQueue(player: Player): Promise<Track[]> {
	const tracks = [...player.queue.tracks];
	const requesterMap = new Map<string, any[]>();

	// Group tracks by requester
	for (const track of tracks) {
		const requesterId = getRequesterId(track.requester);
		if (!requesterMap.has(requesterId)) {
			requesterMap.set(requesterId, []);
		}
		requesterMap.get(requesterId)?.push(track);
	}

	// Build fair queue
	const fairQueue: Track[] = [];
	const requesterIndices = new Map<string, number>();
	for (const requesterId of requesterMap.keys()) {
		requesterIndices.set(requesterId, 0);
	}

	let tracksAdded = 0;
	while (tracksAdded < tracks.length) {
		for (const [requesterId, trackList] of requesterMap.entries()) {
			const currentIndex = requesterIndices.get(requesterId)!;
			if (currentIndex < trackList.length) {
				fairQueue.push(trackList[currentIndex]);
				requesterIndices.set(requesterId, currentIndex + 1);
				tracksAdded++;
			}
		}
	}

	// Clear the player's queue and add the fair queue tracks
	await player.queue.splice(0, player.queue.tracks.length);
	await player.queue.add(fairQueue); // Add all tracks at once

	return fairQueue;
}
