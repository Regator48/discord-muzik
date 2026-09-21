import type {
	ApplicationCommandOptionChoiceData,
	AutocompleteInteraction,
	VoiceChannel,
} from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { type SearchResult } from "lavalink-client";
import { I18N, t } from "../../structures/I18n";
import { Command, type Context, type Lavamusic } from "../../structures/index";
import { applyFairPlayToQueue } from "../../utils/functions/player";
import {
	Connect,
	EmbedLinks,
	ReadMessageHistory,
	SendMessages,
	Speak,
	ViewChannel,
} from "../../utils/Permissions";
import {
	loadProxyTrack,
	mapLimit,
	proxyFetch,
	proxyResolve,
	qualityLine,
	type PendingPlaylist,
	type ProxyEntry,
	type SpotifyItem,
} from "../../utils/ProxyStream";

const YT_PLAYLIST_RE = /(?:youtube\.com|youtu\.be)\/.*[?&]list=([a-zA-Z0-9_-]+)/;
const SPOTIFY_RE = /open\.spotify\.com\/(?:playlist|album|track)\//i;

interface PlaylistData {
	items: ProxyEntry[];
}

interface SpotifyData {
	items: SpotifyItem[];
}

export default class Play extends Command {
	constructor(client: Lavamusic) {
		super(client, {
			name: "play",
			description: {
				content: I18N.commands.play.description,
				examples: [
					"play example",
					"play https://www.youtube.com/watch?v=example",
					"play https://open.spotify.com/track/example",
					"play http://www.example.com/example.mp3",
				],
				usage: "play <song>",
			},
			category: "music",
			aliases: ["p"],
			cooldown: 3,
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
					name: "song",
					description: t(I18N.commands.play.options.song),
					type: 3,
					required: true,
					autocomplete: true,
				},
			],
		});
	}

	private loadMoreRow(remaining: number): ActionRowBuilder<ButtonBuilder> {
		return new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId("playlist-load-more")
				.setLabel(`Load ${Math.min(20, remaining)} more (${remaining} remaining)`)
				.setStyle(ButtonStyle.Secondary),
		);
	}

	private async startPlaylist(
		client: Lavamusic,
		ctx: Context,
		player: any,
		type: "youtube" | "spotify",
		loaded: number,
		remaining: ProxyEntry[] | SpotifyItem[],
		message: string,
	): Promise<any> {
		if (remaining.length > 0) {
			const session: PendingPlaylist = {
				type,
				items: remaining as PendingPlaylist["items"],
				loaded,
				loading: false,
			};
			player.set("pendingPlaylist", session);
		} else {
			player.set("pendingPlaylist", null as any);
		}

		const response: any = {
			content: "",
			embeds: [
				client
					.embed()
					.setColor(client.color.main)
					.setDescription(message + "\n`MP3 • 128 kbps per track`"),
			],
		};
		if (remaining.length > 0) {
			response.components = [this.loadMoreRow(remaining.length)];
		}
		return await ctx.editMessage(response);
	}

	private async loadBatch(
		player: any,
		user: { id: string },
		batch: (ProxyEntry | SpotifyItem)[],
		type: "youtube" | "spotify",
	): Promise<{ tracks: (Track | null)[]; added: number }> {
		console.log("[Play] loadBatch: type", type, "batch size", batch.length);
		const tracks = await mapLimit(batch, 4, async (item) => {
			if (type === "spotify") {
				const resolved = await proxyResolve(`ytsearch:${item.query || item.title}`);
				console.log("[Play] loadBatch: resolved", item.query, "->", resolved?.title, "| url:", resolved?.pageUrl);
				if (!resolved) return null;
				const track = await loadProxyTrack(player, user, resolved);
				console.log("[Play] loadBatch: loaded track:", track?.info?.title, "| loadType:", track ? "ok" : "null");
				return track;
			}
			const track = await loadProxyTrack(player, user, item as ProxyEntry);
			console.log("[Play] loadBatch: loaded youtube entry:", item.title, "| loadType:", track ? "ok" : "null");
			return track;
		});
		let added = 0;
		for (const track of tracks) {
			if (!track) {
				console.log("[Play] loadBatch: skipped null track");
				continue;
			}
			await player.queue.add(track);
			added++;
			console.log("[Play] loadBatch: queued track", track.info?.title);
		}
		console.log("[Play] loadBatch: total added", added);
		return { tracks, added };
	}

	private async searchAndQueueTrack(
		player: any,
		user: any,
		query: string,
	): Promise<boolean> {
		const resolved = await proxyResolve(`ytsearch:${query}`);
		if (!resolved) return false;
		const track = await loadProxyTrack(player, user, resolved);
		if (!track) return false;
		await player.queue.add(track);
		return true;
	}

	private async addSpotifyPlaylist(
		client: Lavamusic,
		ctx: Context,
		player: any,
		url: string,
	): Promise<any> {
		const data = await proxyFetch<SpotifyData>("spotify", {
			url,
			limit: "100",
		});
		if (!data || data.items?.length === 0) {
			return await ctx.editMessage({
				content: "",
				embeds: [
					client
						.embed()
						.setColor(client.color.red)
						.setDescription(ctx.locale(I18N.commands.play.errors.search_error)),
				],
			});
		}

		const tracksToLoad = data.items.slice(0, 20);
		let added = 0;

		// First 5: sequential for instant playback
		for (const item of tracksToLoad.slice(0, 5)) {
			if (await this.searchAndQueueTrack(player, ctx.author, item.query || item.title)) {
				added++;
			}
		}

		if (added > 0 && !player.playing && player.queue.tracks.length >= 1) {
			await player.play({ paused: false });
			await ctx.editMessage({
				content: "",
				embeds: [
					client
						.embed()
						.setColor(client.color.main)
						.setDescription(
							ctx.locale(I18N.commands.play.loading) + ` — ${added}/5 • already playing first song`,
						),
				],
			});
		}

		// Remaining 15: gentle background load *after* the first song starts
		// playing smoothly — waiting before resolving avoids starving the live
		// stream during its critical first seconds (fixes startup stutter).
		const remainingItems = tracksToLoad.slice(5);
		if (remainingItems.length > 0) {
			const results = await mapLimit(
				remainingItems,
				2,
				async (item) => {
					await new Promise((r) => setTimeout(r, 400));
					return this.searchAndQueueTrack(player, ctx.author, item.query || item.title);
				}
			);
			results.forEach((r) => { if (r) added++; });
		}

		const remaining = data.items.slice(20);
		const message = `${ctx.locale(I18N.commands.play.added_playlist_to_queue, {
			length: Math.min(20, data.items.length),
		})}${data.items.length > 20 ? `\nDeeper into the playlist? Use the button below.` : ""}`;

		return await this.startPlaylist(client, ctx, player, "spotify", Math.min(20, data.items.length), remaining, message);
	}

	private async addYoutubePlaylist(
		client: Lavamusic,
		ctx: Context,
		player: any,
		url: string,
	): Promise<any> {
		const data = await proxyFetch<PlaylistData>("playlist", {
			url,
			limit: "100",
		});
		if (!data || data.items?.length === 0) {
			return await ctx.editMessage({
				content: "",
				embeds: [
					client
						.embed()
						.setColor(client.color.red)
						.setDescription(ctx.locale(I18N.commands.play.errors.search_error)),
				],
			});
		}

		const tracksToLoad = data.items.slice(0, 20);
		let added = 0;

		// First 5: sequential for instant playback
		for (const entry of tracksToLoad.slice(0, 5)) {
			const query = entry.title + (entry.author ? ` ${entry.author}` : "");
			if (await this.searchAndQueueTrack(player, ctx.author, query)) {
				added++;
			}
		}

		if (added > 0 && !player.playing && player.queue.tracks.length >= 1) {
			await player.play({ paused: false });
			await ctx.editMessage({
				content: "",
				embeds: [
					client
						.embed()
						.setColor(client.color.main)
						.setDescription(
							ctx.locale(I18N.commands.play.loading) + ` — ${added}/${Math.min(5, tracksToLoad.length)} • already playing first song`,
						),
				],
			});
		}

		// Remaining 15: gentle background load *after* the first song starts
		// playing smoothly — waiting before resolving avoids starving the live
		// stream during its critical first seconds (fixes startup stutter).
		const remainingItems = tracksToLoad.slice(5);
		if (remainingItems.length > 0) {
			const results = await mapLimit(
				remainingItems,
				2,
				async (entry) => {
					await new Promise((r) => setTimeout(r, 400));
					const query = entry.title + (entry.author ? ` ${entry.author}` : "");
					return this.searchAndQueueTrack(player, ctx.author, query);
				}
			);
			results.forEach((r) => { if (r) added++; });
		}

		const remaining = data.items.slice(20);
		const message = `${ctx.locale(I18N.commands.play.added_playlist_to_queue, {
			length: Math.min(20, data.items.length),
		})}${data.items.length > 20 ? `\nDeeper into the playlist? Use the button below.` : ""}`;

		return await this.startPlaylist(client, ctx, player, "youtube", Math.min(20, data.items.length), remaining, message);
	}

	public async run(client: Lavamusic, ctx: Context, args: string[]): Promise<any> {
		console.error("[Play] run: started, query:", args.join(" "));
		const query = args.join(" ");
		await ctx.sendDeferMessage(ctx.locale(I18N.commands.play.loading));
		let player = client.manager.getPlayer(ctx.guild.id);
		const memberVoiceChannel = (ctx.member as any).voice.channel as VoiceChannel;

		if (!player)
			player = client.manager.createPlayer({
				guildId: ctx.guild.id,
				voiceChannelId: memberVoiceChannel.id,
				textChannelId: ctx.channel.id,
				selfMute: false,
				selfDeaf: true,
				vcRegion: memberVoiceChannel.rtcRegion!,
			});

		if (!player.connected) await player.connect();

		const trimmed = query.trim();
		const isUrl = /^https?:\/\//i.test(trimmed);
		const isYoutubePlaylist = YT_PLAYLIST_RE.test(trimmed);
		const isYoutube =
			/^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com|youtu\.be)/i.test(trimmed);
		const isSpotify = SPOTIFY_RE.test(trimmed);

		const embed = this.client.embed();

		if (isSpotify) return await this.addSpotifyPlaylist(client, ctx, player, trimmed);
		if (isYoutubePlaylist) return await this.addYoutubePlaylist(client, ctx, player, trimmed);

		let response: SearchResult;

		if (!isUrl || isYoutube) {
			const target = isUrl ? trimmed : `ytsearch:${trimmed}`;
			const resolved = await proxyResolve(target);
			if (resolved) {
				const track = await loadProxyTrack(player, ctx.author, resolved);
				if (track) {
					response = {
						loadType: "track",
						tracks: [track],
						pluginInfo: {},
					} as SearchResult;
				}
			}
		}

		if (!response) {
			try {
				// Use ytdlp-proxy for ytsearch to avoid YouTube OAuth issues
				const target = `ytsearch:${query}`;
				const resolved = await proxyResolve(target);
				if (resolved) {
					const track = await loadProxyTrack(player, ctx.author, resolved);
					if (track) {
						response = {
							loadType: "track",
							tracks: [track],
							pluginInfo: {},
						} as SearchResult;
					}
				}
			} catch (error: any) {
				console.error("[Play] run error:", error?.message, error?.stack);
				return await ctx.editMessage({
					content: "",
					embeds: [
						this.client
							.embed()
							.setColor(this.client.color.red)
							.setDescription(ctx.locale(I18N.commands.play.errors.search_error)),
					],
				});
			}
		}

		if (!response || response.tracks?.length === 0) {
			return await ctx.editMessage({
				content: "",
				embeds: [
					embed
						.setColor(this.client.color.red)
						.setDescription(ctx.locale(I18N.commands.play.errors.search_error)),
				],
			});
		}

		await player.queue.add(response.loadType === "playlist" ? response.tracks : response.tracks[0]);

		const fairPlayEnabled = player.get<boolean>("fairplay");
		if (fairPlayEnabled) {
			await applyFairPlayToQueue(player);
		}

		if (response.loadType === "playlist") {
			await ctx.editMessage({
				content: "",
				embeds: [
					embed.setColor(this.client.color.main).setDescription(
						ctx.locale(I18N.commands.play.added_playlist_to_queue, {
							length: response.tracks.length,
						}),
					),
				],
			});
		} else {
			await ctx.editMessage({
				content: "",
				embeds: [
					embed.setColor(this.client.color.main).setDescription(
						ctx.locale(I18N.commands.play.added_to_queue, {
							title: response.tracks[0].info.title,
							uri: response.tracks[0].info.uri,
						}) + qualityLine((response.tracks[0].info as any).abr),
					),
				],
			});
		}
		if (!player.playing && player.queue.tracks.length > 0) await player.play({ paused: false });
	}
	public async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
		const focusedValue = interaction.options.getFocused(true);

		if (!focusedValue?.value.trim()) {
			return interaction.respond([]);
		}

		const res = await this.client.manager.search(focusedValue.value.trim(), interaction.user);
		const songs: ApplicationCommandOptionChoiceData[] = [];

		if (res.loadType === "search") {
			res.tracks.slice(0, 10).forEach((track) => {
				const name = `${track.info.title} by ${track.info.author}`;
				songs.push({
					name: name.length > 100 ? `${name.substring(0, 97)}...` : name,
					value: track.info.uri,
				});
			});
		}

		return await interaction.respond(songs);
	}
}