import { Command, type Context, type Lavamusic } from "../../structures/index";
import { linkChannels } from "../../utils/ChannelLinks";
import { EmbedLinks, ReadMessageHistory, SendMessages, ViewChannel } from "../../utils/Permissions";

export default class Link extends Command {
	constructor(client: Lavamusic) {
		super(client, {
			name: "link",
			description: {
				content: "Link this channel to another channel for message syncing",
				usage: "link <channel>",
				examples: ["link #general"],
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
					description: "The channel to link to",
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
						.setDescription("Invalid channel. Use `#link <#channel>` or select a channel."),
				],
			});
		}

		const targetChannel = ctx.guild.channels.cache.get(targetChannelId);
		if (!targetChannel) {
			return await ctx.sendMessage({
				embeds: [
					client
						.embed()
						.setColor(client.color.red)
						.setDescription("Channel not found!"),
				],
			});
		}

		const sourceChannelId = ctx.channel.id;
		if (sourceChannelId === targetChannelId) {
			return await ctx.sendMessage({
				embeds: [
					client
						.embed()
						.setColor(client.color.red)
						.setDescription("Cannot link a channel to itself!"),
				],
			});
		}

		const linked = linkChannels(sourceChannelId, targetChannelId);
		if (!linked) {
			return await ctx.sendMessage({
				embeds: [
					client
						.embed()
						.setColor(client.color.yellow)
						.setDescription("Channels are already linked!"),
				],
			});
		}

		return await ctx.sendMessage({
			embeds: [
				client
					.embed()
					.setColor(client.color.green)
					.setDescription(`Linked ${ctx.channel} to ${targetChannel}`),
			],
		});
	}
}
