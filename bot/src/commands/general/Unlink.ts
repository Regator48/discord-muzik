import { Command, type Context, type Lavamusic } from "../../structures/index";
import { unlinkChannels } from "../../utils/ChannelLinks";
import { EmbedLinks, ReadMessageHistory, SendMessages, ViewChannel } from "../../utils/Permissions";

export default class Unlink extends Command {
	constructor(client: Lavamusic) {
		super(client, {
			name: "unlink",
			description: {
				content: "Unlink this channel from another channel",
				usage: "unlink <channel>",
				examples: ["unlink #general"],
			},
			category: "general",
			aliases: [],
			cooldown: 3,
			args: true,
			vote: false,
			player: { voice: false, dj: false, active: false, djPerm: null },
			permissions: {
				dev: false,
				client: [SendMessages, ReadMessageHistory, ViewChannel, EmbedLinks],
				user: [],
			},
			slashCommand: true,
			options: [
				{
					name: "channel",
					description: "The channel to unlink from",
					type: 7,
					required: true,
				},
			],
		});
	}

	public async run(client: Lavamusic, ctx: Context, args: string[]): Promise<any> {
		let targetChannelId: string;

		if (ctx.isInteraction) {
			targetChannelId = ctx.interaction.options.getChannel("channel")?.id;
		} else {
			const match = args[0]?.match(/^<#(\d+)>$/);
			targetChannelId = match ? match[1] : args[0];
		}

		if (!targetChannelId) {
			return await ctx.sendMessage({
				embeds: [
					client
						.embed()
						.setColor(client.color.red)
						.setDescription("Invalid channel. Use `#unlink <#channel>` or select a channel."),
				],
			});
		}

		const unlinked = unlinkChannels(ctx.channel.id, targetChannelId);
		if (!unlinked) {
			return await ctx.sendMessage({
				embeds: [
					client
						.embed()
						.setColor(client.color.yellow)
						.setDescription("Channels are not linked!"),
				],
			});
		}

		const targetChannel = ctx.guild.channels.cache.get(targetChannelId);
		return await ctx.sendMessage({
			embeds: [
				client
					.embed()
					.setColor(client.color.green)
					.setDescription(`Unlinked ${ctx.channel} from ${targetChannel ?? `<#${targetChannelId}>`}`),
			],
		});
	}
}
