import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonInteraction,
	ButtonStyle,
	EmbedBuilder,
	MessageFlags,
} from "discord.js";
import { Component, type Lavamusic } from "../../structures";
import { handlePlayerInteraction } from "../../utils/PlayerUIUtils";
import { loadProxyTrack, mapLimit, proxyResolve } from "../../utils/ProxyStream";

const BATCH = 20;

async function searchAndQueueTrack(
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

export default class LoadMoreButton extends Component {
	constructor(client: Lavamusic) {
		super(client, {
			name: "playlist-load-more",
			aliases: ["PLAYLIST_LOAD_MORE"],
		});
	}

	public async run(interaction: ButtonInteraction): Promise<any> {
		const player = await handlePlayerInteraction(this.client, interaction);
		if (!player) return;

		const session = player.get<{ type: "youtube" | "spotify"; items: { title: string; query?: string; author?: string }[]; loaded: number; loading: boolean }>("pendingPlaylist");

		if (!session || session.items.length === 0) {
			return await interaction.reply({
				content: "No more songs to load for this playlist.",
				flags: MessageFlags.Ephemeral,
			});
		}

		if (session.loading) {
			return await interaction.reply({
				content: "Loading in progress, wait a moment before clicking again.",
				flags: MessageFlags.Ephemeral,
			});
		}

		session.loading = true;
		player.set("pendingPlaylist", session);
		await interaction.deferUpdate();

		const batch = session.items.splice(0, BATCH);
		let added = 0;

		try {
			// Gentle pacing — resolve at most 2 at a time with a small delay
			// between starts so active playback doesn't stutter.
			const results = await mapLimit(batch, 2, async (item) => {
				const query = item.query || item.title + (item.author ? ` ${item.author}` : "");
				await new Promise((r) => setTimeout(r, 400));
				return searchAndQueueTrack(player, interaction.user, query);
			});
			added = results.filter(Boolean).length;
		} finally {
			// Always reset the loading flag, even if a track load throws —
			// otherwise the button stays stuck on "Loading in progress" forever.
			session.loaded += added;
			session.loading = false;
			player.set("pendingPlaylist", session);
		}

		if (!player.playing && player.queue.tracks.length > 0) {
			await player.play({ paused: false }).catch(() => {});
		}

		const remaining = session.items.length;
		const embed = new EmbedBuilder()
			.setColor(this.client.color.main)
			.setDescription(
				`Loaded **${added}** more songs (${session.loaded} total in queue).` +
					`\n\`MP3 • 128 kbps\``,
			);

		const components =
			remaining > 0
				? [
						new ActionRowBuilder<ButtonBuilder>().addComponents(
							new ButtonBuilder()
								.setCustomId("playlist-load-more")
								.setLabel(`Load ${Math.min(BATCH, remaining)} more (${remaining} remaining)`)
								.setStyle(ButtonStyle.Secondary),
						),
					]
				: [];

		return await interaction.editReply({ embeds: [embed], components });
	}
}