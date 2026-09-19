import type { VoiceChannel } from "discord.js";
import { Command, type Context, type Lavamusic } from "../../structures/index";
import {
	Connect,
	EmbedLinks,
	ReadMessageHistory,
	SendMessages,
	Speak,
	ViewChannel,
} from "../../utils/Permissions";

const LX_PROXY_URL = process.env.LX_PROXY_URL || "http://127.0.0.1:4568";

/**
 * Lavalink's HTTP source returns "Unknown title" for bare streams.
 * Stamp the track with the real Chinese metadata so queue/now-playing displays work.
 */
function applyLxMetadata(track: any, item: { name?: string; singer?: string; album?: string }, extra?: Record<string, unknown>): any {
	track.info = track.info || {};
	track.info.title = item.name || track.info.title;
	track.info.author = item.singer || track.info.author;
	track.pluginInfo = track.pluginInfo || {};
	track.pluginInfo.clientData = {
		...(track.pluginInfo.clientData || {}),
		lxInfo: { name: item.name, singer: item.singer },
		...extra,
	};
	return track;
}
const NETEASE_PLAYLIST_RE = /music\.163\.com\/(?:(?:m|#)\/)?playlist/i;
const PLAYLIST_BATCH_SIZE = 20;

export default class LxPlay extends Command {
	constructor(client: Lavamusic) {
		super(client, {
			name: "lx",
			description: {
				content: "Search and play Chinese music from QQ/NetEase/KuWo/KuGou/Migu via aggregated sources",
				usage: "lx <song name | netease playlist url>",
				examples: ["lx 晴天", "lx 周杰伦", "lx https://music.163.com/playlist?id=9101955201"],
			},
			category: "music",
			aliases: ["lxplay"],
			cooldown: 5,
			args: true,
			vote: false,
			player: {
				voice: true,
				dj: false,
				active: false,
				djPerm: null,
			},
			permissions: {
				dev: false,
				client: [SendMessages, ReadMessageHistory, ViewChannel, EmbedLinks, Connect, Speak],
				user: [],
			},
			slashCommand: true,
			options: [
				{
					name: "query",
					description: "Song name to search, or a NetEase Cloud Music playlist URL",
					type: 3,
					required: true,
				},
			],
		});
	}

	private parseNeteasePlaylistId(query: string): string | null {
		if (!NETEASE_PLAYLIST_RE.test(query)) return null;
		const match = query.match(/[?&]id=(\d+)/);
		return match?.[1] ?? null;
	}

	private async addNeteasePlaylist(client: Lavamusic, ctx: Context, playlistId: string): Promise<any> {
		let data: any = null;
		try {
			const res = await fetch(`${LX_PROXY_URL}/wy/playlist?id=${encodeURIComponent(playlistId)}`, {
				signal: AbortSignal.timeout(20000),
			});
			data = await res.json();
		} catch {}

		const items: any[] = Array.isArray(data?.items) ? data.items.slice(0, PLAYLIST_BATCH_SIZE) : [];
		if (items.length === 0) {
			return await ctx.editMessage({
				content: "",
				embeds: [
					client
						.embed()
						.setColor(client.color.red)
						.setDescription("Could not load that NetEase playlist. The LX Proxy may be down, or the playlist is empty/private."),
				],
			});
		}

		const memberVoiceChannel = ctx.member?.voice.channel as VoiceChannel | undefined;
		if (!memberVoiceChannel) {
			return await ctx.editMessage({
				content: "",
				embeds: [
					client
						.embed()
						.setColor(client.color.red)
						.setDescription("You need to be in a voice channel!"),
				],
			});
		}

		let player = client.manager.getPlayer(ctx.guild.id);
		if (!player) {
			player = client.manager.createPlayer({
				guildId: ctx.guild.id,
				voiceChannelId: memberVoiceChannel.id,
				textChannelId: ctx.channel.id,
				selfMute: false,
				selfDeaf: true,
				vcRegion: memberVoiceChannel.rtcRegion!,
			});
		}
		if (!player.connected) await player.connect();

		const resolveAndQueue = async (item: any): Promise<boolean> => {
			try {
				const urlParams = new URLSearchParams({
					source: "wy",
					id: String(item.id || ""),
					quality: "320k",
					name: item.name || "",
					singer: item.singer || "",
				});
				const urlRes = await fetch(`${LX_PROXY_URL}/url?${urlParams}`, { signal: AbortSignal.timeout(20000) });
				const urlData: any = await urlRes.json();
				if (!urlData?.url) return false;
				const searchResult = await client.manager.search({ query: urlData.url, source: "http" }, ctx.author);
				const track = searchResult?.tracks?.[0];
				if (!track) return false;
				applyLxMetadata(track, item);
				await player.queue.add(track);
				return true;
			} catch {
				return false;
			}
		};

		// First 5 sequential for instant playback, rest in parallel
		let added = 0;
		for (const item of items.slice(0, 5)) {
			if (await resolveAndQueue(item)) added++;
		}
		if (added > 0 && !player.playing && player.queue.tracks.length > 0) {
			await player.play({ paused: false });
		}
		const results = await Promise.allSettled(items.slice(5).map(resolveAndQueue));
		for (const r of results) {
			if (r.status === "fulfilled" && r.value) added++;
		}

		if (added === 0) {
			return await ctx.editMessage({
				content: "",
				embeds: [
					client
						.embed()
						.setColor(client.color.red)
						.setDescription(`Could not resolve any tracks from playlist **${data?.name || playlistId}**.`),
				],
			});
		}

		let description = `Added **${added}** track${added === 1 ? "" : "s"} from NetEase playlist **${data?.name || playlistId}** to the queue.\n\n`;
		description += items
			.slice(0, Math.min(added, 10))
			.map((t: any, i: number) => `${i + 1}. ${t.name} — ${t.singer}`)
			.join("\n");
		const total = Number(data?.count) || items.length;
		if (total > items.length) {
			description += `\n\n-# Playlist has ${total} tracks — only the first ${items.length} were queued.`;
		}

		return await ctx.editMessage({
			content: "",
			embeds: [client.embed().setColor(client.color.main).setDescription(description)],
		});
	}

	public async run(client: Lavamusic, ctx: Context, args: string[]): Promise<any> {
		const query = args.join(" ");
		if (!query) {
			return await ctx.sendMessage({
				embeds: [
					client
						.embed()
						.setColor(client.color.red)
						.setDescription("Please provide a song name. Usage: `#lx <song name>`"),
				],
			});
		}

		const playlistId = this.parseNeteasePlaylistId(query);
		if (playlistId) {
			await ctx.sendDeferMessage("Loading NetEase playlist...");
			return await this.addNeteasePlaylist(client, ctx, playlistId);
		}

		await ctx.sendDeferMessage("Searching Chinese music sources...");

		// Step 1: Search via LX proxy
		let tracks: any[] = [];
		try {
			const searchUrl = `${LX_PROXY_URL}/search?q=${encodeURIComponent(query)}`;
			const res = await fetch(searchUrl, { signal: AbortSignal.timeout(15000) });
			const data = await res.json();
			tracks = data?.tracks || [];
		} catch (e) {
			return await ctx.editMessage({
				content: "",
				embeds: [
					client
						.embed()
						.setColor(client.color.red)
						.setDescription("LX Proxy is not running! Start it with `docker compose up -d lx-proxy`."),
				],
			});
		}

		if (tracks.length === 0) {
			return await ctx.editMessage({
				content: "",
				embeds: [
					client
						.embed()
						.setColor(client.color.red)
						.setDescription(`No results found for **${query}**`),
				],
			});
		}

		// Step 2: Show results and auto-pick first, or let user pick
		const top = tracks.slice(0, 10);
		const embed = client
			.embed()
			.setColor(client.color.main)
			.setTitle("Chinese Music Search Results")
			.setDescription(
				top
					.map(
						(t: any, i: number) =>
							`**${i + 1}.** ${t.name} — ${t.singer}${t.album ? ` (${t.album})` : ""} [${t.platform || "?"}]`,
					)
					.join("\n") + "\n\n-# Reply a number (1-10) to pick, **0** to reject all, or I'll play the first result...",
			);

		await ctx.editMessage({ content: "", embeds: [embed] });

		// Wait 15 seconds for user to pick
		const filter = (m: any) =>
			m.author.id === ctx.author.id &&
			/^\d+$/.test(m.content.trim()) &&
			((Number(m.content.trim()) === 0) || (Number(m.content.trim()) >= 1 && Number(m.content.trim()) <= top.length));

		let selected: any;
		try {
			const collected = await ctx.channel!.awaitMessages({
				filter,
				max: 1,
				time: 15000,
				errors: ["time"],
			});
			const reply = collected.first().content.trim();
			const picked = Number(reply);
			await collected.first().delete().catch(() => {});
			if (picked === 0) {
				return await ctx.editMessage({
					content: "",
					embeds: [
						client
							.embed()
							.setColor(client.color.red)
							.setDescription(`Search for **${query}** rejected. Nothing queued.`),
					],
				});
			}
			selected = top[picked - 1];
		} catch {
			selected = top[0];
		}

		// Step 3: Get streaming URL from proxy
		const memberVoiceChannel = ctx.member?.voice.channel as VoiceChannel | undefined;
		if (!memberVoiceChannel) {
			return await ctx.editMessage({
				content: "",
				embeds: [
					client
						.embed()
						.setColor(client.color.red)
						.setDescription("You need to be in a voice channel!"),
				],
			});
		}

		let player = client.manager.getPlayer(ctx.guild.id);
		if (!player) {
			player = client.manager.createPlayer({
				guildId: ctx.guild.id,
				voiceChannelId: memberVoiceChannel.id,
				textChannelId: ctx.channel.id,
				selfMute: false,
				selfDeaf: true,
				vcRegion: memberVoiceChannel.rtcRegion!,
			});
		}
		if (!player.connected) await player.connect();

		// Try to get stream URL via proxy — use the search result's platform first
		let streamUrl: string | null = null;
		const platformMap: Record<string, string> = { "QQ": "tx", "酷我": "kw", "网易云": "wy", "酷狗": "kg", "咪咕": "mg" };
		const searchPlatform = platformMap[selected.platform] || selected.platform || "kw";
		// Try search platform first, then others
		const platforms = [searchPlatform, ...["kw", "tx", "wy", "kg", "mg"].filter((p) => p !== searchPlatform)];

		for (const plat of platforms) {
			try {
				const urlParams = new URLSearchParams({
					source: plat,
					id: selected.id || "",
					quality: "320k",
					name: selected.name || "",
					singer: selected.singer || "",
				});
				const urlRes = await fetch(`${LX_PROXY_URL}/url?${urlParams}`, { signal: AbortSignal.timeout(20000) });
				const urlData = await urlRes.json();
				if (urlData?.url) {
					streamUrl = urlData.url;
					break;
				}
			} catch {}
		}

		if (!streamUrl) {
			return await ctx.editMessage({
				content: "",
				embeds: [
					client
						.embed()
						.setColor(client.color.red)
						.setDescription(`Could not get streaming URL for **${selected.name}** from any source.`),
				],
			});
		}

		// Step 4: Play via Lavalink using http source
		try {
			const searchResult = await client.manager.search({ query: streamUrl, source: "http" }, ctx.author);
			if (searchResult && Array.isArray(searchResult.tracks) && searchResult.tracks.length > 0) {
				const track = searchResult.tracks[0];
				applyLxMetadata(track, selected);
				await player.queue.add(track);
				// Store LX metadata so autoplay can suggest the same artist's songs
				player.set("lxTrack", { name: selected.name, singer: selected.singer });
				player.set("autoplay", true);
				if (!player.playing && player.queue.tracks.length > 0) {
					await player.play({ paused: false });
				}

				let queueText = `Now playing: **${selected.name}** — ${selected.singer}\n` + `-# Source: ${selected.platform || "Chinese Music"} | 320k\n\n`;
				const upcoming = player.queue.tracks.slice(0, 10);
				if (upcoming.length > 1) {
					queueText += `**Up next (${player.queue.tracks.length - 1} song${player.queue.tracks.length - 1 > 1 ? "s" : ""}):**\n`;
					queueText += upcoming
						.slice(1)
						.map((t: any, i: number) => {
							const lx = t.pluginInfo?.clientData?.lxInfo;
							const label = lx ? `${lx.name} — ${lx.singer}` : t.info.title;
							return `${i + 1}. ${label}`;
						})
						.join("\n");
				} else {
					queueText += `\n-# Auto-suggest is on — a similar song will play when this ends. Use \`#autoplay\` to toggle.`;
				}

				await ctx.editMessage({ content: "", embeds: [client.embed().setColor(client.color.green).setDescription(queueText)] });
			} else {
				throw new Error("Lavalink could not load the stream URL");
			}
		} catch (e: any) {
			return await ctx.editMessage({
				content: "",
				embeds: [
					client
						.embed()
						.setColor(client.color.red)
						.setDescription(`Failed to play **${selected.name}**: ${e?.message || "Unknown error"}`),
				],
			});
		}
	}
}
