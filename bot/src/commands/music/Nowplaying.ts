import { ContainerBuilder, MessageFlags, SectionBuilder } from "discord.js";
import { I18N } from "../../structures/I18n";
import { Command, type Context, type Lavamusic } from "../../structures/index";
import { EmbedLinks, ReadMessageHistory, SendMessages, ViewChannel } from "../../utils/Permissions";

function getRequesterDisplay(requester: unknown): string {
	if (!requester) return "Unknown";
	if (typeof requester === "string") return requester;
	if (typeof requester === "object" && "id" in requester && typeof (requester as { id: unknown }).id === "string") {
		return (requester as { id: string }).id;
	}
	if (typeof requester === "object" && "username" in requester && typeof (requester as { username: unknown }).username === "string") {
		return (requester as { username: string }).username;
	}
	return "Unknown";
}

export default class Nowplaying extends Command {
	constructor(client: Lavamusic) {
		super(client, {
			name: "nowplaying",
			description: {
				content: I18N.commands.nowplaying.description,
				examples: ["nowplaying"],
				usage: "nowplaying",
			},
			category: "music",
			aliases: ["np"],
			cooldown: 3,
			args: false,
			vote: false,
			player: {
				voice: true,
				dj: false,
				active: true,
				djPerm: null,
			},
			permissions: {
				dev: false,
				client: [SendMessages, ReadMessageHistory, ViewChannel, EmbedLinks],
				user: [],
			},
			slashCommand: true,
			options: [],
		});
	}

	public async run(client: Lavamusic, ctx: Context): Promise<any> {
		const player = client.manager.getPlayer(ctx.guild.id);

		if (!player || !player.queue.current) {
			const noMusic = ctx.locale(I18N.events.message.no_music_playing);
			const container = new ContainerBuilder()
				.setAccentColor(this.client.color.red)
				.addSectionComponents(
					new SectionBuilder().addTextDisplayComponents((td) => td.setContent(noMusic)),
				);
			return ctx.sendMessage({
				components: [container],
				flags: MessageFlags.IsComponentsV2,
			});
		}

		const track = player.queue.current!;
		const pos = player.position;
		const dur = track.info.duration;
		const bar = client.utils.progressBar(pos, dur, 20);

		const label = ctx.locale(I18N.commands.nowplaying.now_playing);

		const sourceName = track.info.sourceName || "unknown";
		const sourceIcons: Record<string, string> = {
			youtube: "https://i.imgur.com/xzVHhFY.png",
			youtubemusic: "https://i.imgur.com/xzVHhFY.png",
			soundcloud: "https://i.imgur.com/MVnJ7mj.png",
			spotify: "https://i.imgur.com/qvdqtsc.png",
			apple: "https://i.imgur.com/Wi0oyYm.png",
			deezer: "https://i.imgur.com/xyZ43FG.png",
			jiosaavn: "https://i.imgur.com/N9Nt80h.png",
		};

		const trackInfo = ctx.locale(I18N.commands.nowplaying.track_info, {
			title: track.info.title ?? "N/A",
			uri: track.info.uri ?? "about:blank",
			requester: getRequesterDisplay(track.requester),
			duration: track.info.isStream ? "LIVE" : client.utils.formatTime(track.info.duration),
			sourceName,
			sourceIcon: sourceIcons[sourceName] || "",
		});

		const mainSection = new SectionBuilder().addTextDisplayComponents((td) =>
			td.setContent(
				`**${label}**\n${trackInfo}\n\`${client.utils.formatTime(pos)} / ${client.utils.formatTime(dur)}\``,
			),
		);

		if (track.info.artworkUrl) {
			mainSection.setThumbnailAccessory((th) =>
				th
					.setURL(track.info.artworkUrl!)
					.setDescription(`Artwork for ${track.info.title ?? "N/A"}`),
			);
		}

		const nowPlayingContainer = new ContainerBuilder()
			.setAccentColor(this.client.color.main)
			.addSectionComponents(mainSection);

		return ctx.sendMessage({
			components: [nowPlayingContainer],
			flags: MessageFlags.IsComponentsV2,
		});
	}
}