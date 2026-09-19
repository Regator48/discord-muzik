import { I18N } from "../../structures/I18n";
import logger from "../../structures/Logger";
import { Command, type Context, type Lavamusic } from "../../structures/index";
import { ReadMessageHistory } from "../../utils/Permissions";

export default class Error extends Command {
	constructor(client: Lavamusic) {
		super(client, {
			name: "error",
			description: {
				content: I18N.commands.error.description,
				examples: ["error"],
				usage: "error",
			},
			category: "music",
			aliases: ["err"],
			cooldown: 3,
			args: false,
			vote: false,
			player: {
				voice: false,
				dj: false,
				active: false,
				djPerm: null,
			},
			permissions: {
				dev: false,
				client: [ReadMessageHistory],
				user: [],
			},
			slashCommand: true,
			options: [],
		});
	}

	public async run(client: Lavamusic, ctx: Context): Promise<any> {
		try {
			const channel = ctx.channel as import("discord.js").TextChannel;
			const messages = await channel.messages.fetch({ limit: 6 });

			const userMessages = messages
				.filter((m) => !m.author.bot)
				.array()
				.slice(0, 5)
				.reverse();

			if (userMessages.length === 0) {
				return await ctx.sendMessage({
					embeds: [
						client
							.embed()
							.setColor(client.color.yellow)
							.setDescription(
								"**No user messages found** in the last 6 messages.",
							),
					],
				});
			}

			const desc = userMessages
				.map(
					(msg, i) =>
						`**${i + 1}.** ${msg.author.username}: ${msg.content
							? msg.content.substring(0, 100)
							: "(empty message)"}${
								msg.content.length > 100 ? "..." : ""
							}`,
				)
				.join("\n");

			await ctx.sendMessage({
				embeds: [
					client
						.embed()
						.setColor(client.color.main)
						.setDescription(
							"**Past 5 user messages:**\n```\n" + desc + "\n```",
						),
				],
			});
		} catch (error) {
			logger.error("[Error] Failed to fetch messages:", error);
			await ctx.sendMessage({
				embeds: [
					client
						.embed()
						.setColor(client.color.red)
						.setDescription(
							"**Failed to read message history.**\n" +
								"Make sure I have **Read Message History** permission.",
						),
				],
			});
		}
	}
}