import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	StringSelectMenuBuilder,
	type VoiceChannel,
} from "discord.js";
import type { SearchResult } from "lavalink-client";
import { I18N } from "../../structures/I18n";
import { Command, type Context, type Lavamusic } from "../../structures/index";
import {
	EmbedLinks,
	ReadMessageHistory,
	SendMessages,
	ViewChannel,
} from "../../utils/Permissions";

const TRACKS_PER_PAGE = 5;
const proxyUrl = process.env.YTDLP_PROXY || "http://127.0.0.1:4567";

interface ProxyResult {
	title: string;
	author?: string;
	duration: number;
	pageUrl: string;
	thumbnail?: string;
}

async function proxySearch(q: string, n = 5): Promise<ProxyResult[]> {
	try {
		const res = await fetch(`${proxyUrl}/search?q=${encodeURIComponent(q)}&n=${n}`, {
			signal: AbortSignal.timeout(25000),
		});
		if (!res.ok) return [];
		const data = (await res.json()) as { results: ProxyResult[] };
		return Array.isArray(data.results) ? data.results : [];
	} catch {
		return [];
	}
}

export default class Search extends Command {
	constructor(client: Lavamusic) {
		super(client, {
			name: "search",
			description: {
				content: I18N.commands.search.description,
				examples: ["search example"],
				usage: "search <song>",
			},
			category: "music",
			aliases: ["sc"],
			cooldown: 3,
			args: true,
			vote: true,
			player: {
				voice: true,
				dj: false,
				active: false,
				djPerm: null,
			},
			permissions: {
				dev: false,
				client: [SendMessages, ReadMessageHistory, ViewChannel, EmbedLinks],
				user: [],
			},
			slashCommand: true,
			options: [
				{
					name: "song",
					description: I18N.commands.search.options.song,
					type: 3,
					required: true,
				},
			],
		});
	}

	private formatTrackDisplay(result: ProxyResult, index: number): string {
		return (
			`**${index + 1}. [${result.title}](${result.pageUrl})**\n` +
			`${result.author || "Unknown Artist"} • \`${
				result.duration ? this.client.utils.formatTime(result.duration) : "N/A"
			}\``
		);
	}

	private generateComponents(
		client: Lavamusic,
		ctx: Context,
		results: ProxyResult[],
		currentPage: number,
		maxPages: number,
		isDisabled: boolean = false,
	) {
		const startIndex = currentPage * TRACKS_PER_PAGE;
		const endIndex = startIndex + TRACKS_PER_PAGE;
		const tracksOnPage = results.slice(startIndex, Math.min(endIndex, results.length));

		const embed = new EmbedBuilder()
			.setColor(client.color.main)
			.setDescription(
				`**${ctx.locale(I18N.commands.search.messages.results_found, {
					count: results.length,
				})}**\n*${ctx.locale(I18N.commands.search.messages.select_prompt)}*\n\n` +
					`**${ctx.locale(I18N.commands.search.messages.page_info, {
						currentPage: currentPage + 1,
						maxPages: maxPages,
					})}**\n` +
					tracksOnPage.map((t, i) => this.formatTrackDisplay(t, startIndex + i)).join("\n"),
			);

		const selectMenu = new StringSelectMenuBuilder()
			.setCustomId("select-track")
			.setPlaceholder(ctx.locale(I18N.commands.search.select))
			.addOptions(
				tracksOnPage.map((result: ProxyResult, index: number) => ({
					label: `${startIndex + index + 1}. ${result.title.slice(0, 80)}${result.title.length > 80 ? "…" : ""}`,
					description: (result.author || "Unknown Artist").slice(0, 95),
					value: (startIndex + index).toString(),
				})),
			)
			.setDisabled(isDisabled);

		const previousButton = new ButtonBuilder()
			.setCustomId("previous-page")
			.setLabel(ctx.locale(I18N.buttons.previous))
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(currentPage === 0 || isDisabled);

		const nextButton = new ButtonBuilder()
			.setCustomId("next-page")
			.setLabel(ctx.locale(I18N.buttons.next))
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(currentPage === maxPages - 1 || isDisabled);

		return {
			embeds: [embed],
			components: [
				new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu),
				new ActionRowBuilder<ButtonBuilder>().addComponents(previousButton, nextButton),
			],
		};
	}

	public async run(client: Lavamusic, ctx: Context, args: string[]): Promise<any> {
		const query = args.join(" ");
		const memberVoiceChannel = ctx.member?.voice.channel as VoiceChannel | undefined;

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

		if (!player.connected) {
			try {
				await player.connect();
			} catch (error) {
				console.error("Failed to connect to voice channel:", error);
				await player.destroy();
				const embed = new EmbedBuilder()
					.setColor(client.color.red)
					.setDescription(
						`**${ctx.locale(
							I18N.commands.search.errors.vc_connect_fail_title,
						)}**\n${ctx.locale(I18N.commands.search.errors.vc_connect_fail_description)}`,
					);
				return await ctx.sendMessage({ embeds: [embed] });
			}
		}

		const results = await proxySearch(query);

		if (results.length === 0) {
			const embed = new EmbedBuilder()
				.setColor(client.color.red)
				.setDescription(
					`**${ctx.locale(I18N.commands.search.errors.no_results_title)}**\n\n${ctx.locale(
						I18N.commands.search.errors.no_results_description,
					)}`,
				);
			return await ctx.sendMessage({ embeds: [embed] });
		}

		let currentPage = 0;
		const maxPages = Math.ceil(results.length / TRACKS_PER_PAGE);

		const initial = this.generateComponents(client, ctx, results, currentPage, maxPages);
		let sentMessage: any = await ctx.sendMessage(initial);
		if (ctx.isInteraction && !sentMessage?.createMessageComponentCollector) {
			sentMessage = await ctx.interaction!.fetchReply();
		}

		const collector = sentMessage.createMessageComponentCollector({
			filter: (f: any) => f.user.id === ctx.author?.id,
			time: 120000,
			idle: 60000,
		});

		collector.on("collect", async (int: any) => {
			if (int.customId === "select-track") {
				const selectedIndex = Number.parseInt(int.values[0], 10);
				const result = results[selectedIndex];

				await int.deferUpdate();

				if (!result) {
					const embed = new EmbedBuilder()
						.setColor(client.color.red)
						.setDescription(
							`**${ctx.locale(
								I18N.commands.search.errors.invalid_selection_title,
							)}**\n${ctx.locale(I18N.commands.search.errors.invalid_selection_description)}`,
						);
					return await ctx.sendMessage({ embeds: [embed] });
				}

				try {
					const streamUrl = `${proxyUrl}/stream?url=${encodeURIComponent(result.pageUrl)}`;
					const sr = (await player.search({ query: streamUrl }, ctx.author)) as SearchResult;
					if (!sr || sr.tracks?.length === 0) throw new Error("no track loaded");
					const track = sr.tracks[0];
					track.info.title = result.title;
					track.info.author = result.author || "YouTube";
					track.info.duration = result.duration || 0;
					track.info.uri = result.pageUrl;
					track.info.sourceName = "youtube";
					track.info.isStream = true;
					track.info.artworkUrl = result.thumbnail;
					player.queue.add(track);
					if (!player.playing && player.queue.tracks.length > 0)
						await player.play({ paused: false });
				} catch (error) {
					console.error("Failed to load selected track:", error);
					const embed = new EmbedBuilder()
						.setColor(client.color.red)
						.setDescription(
							`**${ctx.locale(
								I18N.commands.search.errors.invalid_selection_title,
							)}**\n${ctx.locale(I18N.commands.search.errors.invalid_selection_description)}`,
						);
					return await int.followUp({ embeds: [embed], ephemeral: true });
				}

				const confirmation = new EmbedBuilder()
					.setColor(client.color.green)
					.setDescription(
						ctx.locale(I18N.commands.search.messages.added_to_queue, {
							title: result.title,
							uri: result.pageUrl,
						}) + "\n`MP3 • 128 kbps`",
					);

				await ctx.editMessage({
					embeds: [confirmation],
					components: [
						new ActionRowBuilder<StringSelectMenuBuilder>()
							.addComponents(
								new StringSelectMenuBuilder()
									.setCustomId("select-track")
									.addOptions({
										label: result.title.slice(0, 80),
										value: selectedIndex.toString(),
									})
									.setDisabled(true),
							),
						new ActionRowBuilder<ButtonBuilder>().addComponents(
							new ButtonBuilder()
								.setCustomId("previous-page")
								.setLabel(ctx.locale(I18N.buttons.previous))
								.setStyle(ButtonStyle.Secondary)
								.setDisabled(true),
							new ButtonBuilder()
								.setCustomId("next-page")
								.setLabel(ctx.locale(I18N.buttons.next))
								.setStyle(ButtonStyle.Secondary)
								.setDisabled(true),
						),
					],
				});

				collector.stop("trackSelected");
			} else if (int.customId === "previous-page" || int.customId === "next-page") {
				if (int.customId === "previous-page" && currentPage > 0) currentPage--;
				else if (int.customId === "next-page" && currentPage < maxPages - 1) currentPage++;
				await int.deferUpdate();
				const updated = this.generateComponents(
					client,
					ctx,
					results,
					currentPage,
					maxPages,
				);
				await ctx.editMessage(updated);
			}
			collector.resetTimer();
		});

		collector.on("end", async (_collected, reason) => {
			if (reason === "time" || reason === "idle") {
				try {
					const embed = new EmbedBuilder()
						.setColor(client.color.red)
						.setDescription(
							`**${ctx.locale(
								I18N.commands.search.messages.selection_timed_out_title,
							)}**\n${ctx.locale(I18N.commands.search.messages.selection_timed_out_description)}`,
						);
					await ctx.editMessage({
						embeds: [embed],
						components: [],
					});
				} catch (error) {
					console.error("Failed to edit message on collector timeout:", error);
					const embed = new EmbedBuilder()
						.setColor(client.color.red)
						.setDescription(ctx.locale(I18N.commands.search.messages.selection_timed_out_short));
					await ctx.sendMessage({ embeds: [embed] });
				}
			}
		});
	}
}