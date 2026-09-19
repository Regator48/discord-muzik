import { Command, type Context, type Lavamusic } from "../../structures/index";
import { getLinkedChannels } from "../../utils/ChannelLinks";
import { EmbedLinks, ReadMessageHistory, SendMessages, ViewChannel } from "../../utils/Permissions";

export default class Links extends Command {
	constructor(client: Lavamusic) {
		super(client, {
			name: "links",
			description: {
				content: "Show linked channels",
				usage: "links",
				examples: ["links"],
			},
			category: "general",
			aliases: [],
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
		const linked = getLinkedChannels(ctx.channel.id);

		if (linked.length === 0) {
			return await ctx.sendMessage({
				embeds: [
					client
						.embed()
						.setColor(client.color.yellow)
						.setDescription("No linked channels."),
				],
			});
		}

		const mentions = linked.map((ch) => `<#${ch}>`).join(", ");
		return await ctx.sendMessage({
			embeds: [
				client
					.embed()
					.setColor(client.color.main)
					.setDescription(`Linked channels: ${mentions}`),
			],
		});
	}
}
