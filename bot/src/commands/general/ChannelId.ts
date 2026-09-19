import { Command, type Context, type Lavamusic } from "../../structures/index";
import { EmbedLinks, ReadMessageHistory, SendMessages, ViewChannel } from "../../utils/Permissions";

export default class ChannelId extends Command {
	constructor(client: Lavamusic) {
		super(client, {
			name: "channelid",
			description: {
				content: "Get the current channel's ID",
				usage: "channelid",
				examples: ["channelid"],
			},
			category: "general",
			aliases: ["cid"],
			cooldown: 3,
			args: false,
			vote: false,
			player: { voice: false, dj: false, active: false, djPerm: null },
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
		return await ctx.sendMessage({
			embeds: [
				client
					.embed()
					.setColor(client.color.main)
					.setDescription(`Channel ID: \`${ctx.channel.id}\``),
			],
		});
	}
}
