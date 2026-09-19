import { Command, type Context, type Lavamusic } from "../../structures/index";
import { EmbedLinks, ReadMessageHistory, SendMessages, ViewChannel } from "../../utils/Permissions";

export default class SyncExisting extends Command {
	constructor(client: Lavamusic) {
		super(client, {
			name: "syncexisting",
			description: {
				content: "Sync existing messages from this channel to a target channel",
				usage: "syncexisting <channel> [limit]",
				examples: ["syncexisting #general", "syncexisting #general 50"],
			},
			category: "general",
			aliases: ["syncex"],
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
					description: "The target channel to sync messages to",
					type: 7,
					required: true,
				},
				{
					name: "limit",
					description: "Number of messages to sync (default: 100)",
					type: 4,
					required: false,
				},
			],
		});
	}

	public async run(client: Lavamusic, ctx: Context, args: string[]): Promise<any> {
		let targetChannelId: string;
		let limit = 100;

		if (ctx.isInteraction) {
			targetChannelId = ctx.interaction.options.getChannel("channel")?.id;
			limit = ctx.interaction.options.getInteger("limit") ?? 100;
		} else {
			const match = args[0]?.match(/^<#(\d+)>$/);
			targetChannelId = match ? match[1] : args[0];
			if (args[1]) limit = parseInt(args[1]) || 100;
		}

		if (!targetChannelId) {
			return await ctx.sendMessage({
				embeds: [
					client
						.embed()
						.setColor(client.color.red)
						.setDescription("Invalid channel. Use `#syncexisting <#channel> [limit]`"),
				],
			});
		}

		const targetChannel = ctx.guild.channels.cache.get(targetChannelId);
		if (!targetChannel || !targetChannel.isTextBased()) {
			return await ctx.sendMessage({
				embeds: [
					client
						.embed()
						.setColor(client.color.red)
						.setDescription("Target channel not found or is not a text channel!"),
				],
			});
		}

		await ctx.sendMessage({
			embeds: [
				client
					.embed()
					.setColor(client.color.yellow)
					.setDescription(`Syncing ${limit} messages...`),
			],
		});

		let count = 0;
		const messages = await ctx.channel.messages.fetch({ limit });

		for (const [, msg] of messages) {
			if (msg.author.bot) continue;

			try {
				if (msg.attachments.size > 0) {
					const attachment = msg.attachments.first();
					const fetched = await fetch(attachment.url);
					const buffer = Buffer.from(await fetched.arrayBuffer());
					const { AttachmentBuilder } = await import("discord.js");
					const file = new AttachmentBuilder(buffer, { name: attachment.name });
					await targetChannel.send({
						content: `**${msg.author.displayName}**: ${msg.content || ""}`,
						files: [file],
					});
				} else {
					await targetChannel.send({
						content: `**${msg.author.displayName}**: ${msg.content}`,
					});
				}
				count++;
			} catch {
				// Skip failed messages
			}
		}

		return await ctx.editMessage({
			embeds: [
				client
					.embed()
					.setColor(client.color.green)
					.setDescription(`Synced ${count} messages to ${targetChannel}`),
			],
		});
	}
}
