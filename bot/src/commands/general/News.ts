import { Command, type Context, type Lavamusic } from "../../structures/index";
import { SendMessages, EmbedLinks, ReadMessageHistory, ViewChannel } from "../../utils/Permissions";
import { EmbedBuilder } from "discord.js";

export default class NewsReport extends Command {
	constructor(client: Lavamusic) {
		super(client, {
			name: "news",
			description: {
				content: "Manually trigger the HK news report to send to Discord",
				usage: "news",
				examples: ["news"],
			},
			category: "general",
			aliases: ["newsreport", "send-news"],
			cooldown: 30,
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
		await ctx.sendDeferMessage("🔄 Triggering news report...");

		try {
			// Bot runs on host network — docker-monitor is on localhost:3001
			const monitorUrl = "http://127.0.0.1:3001";
			const response = await fetch(`${monitorUrl}/api/news/send-to-discord`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
			});

			if (!response.ok) {
				throw new Error(`Docker Monitor error: ${response.status} ${response.statusText}`);
			}

			const result = (await response.json()) as Record<string, unknown>;

			const successEmbed = client
				.embed()
				.setColor(client.color.green)
				.setTitle("📰 News Report Triggered")
				.setDescription((result.message as string) || "News report sent to Discord channel")
				.setFooter({ text: `Requested by ${ctx.author.username}` });

			await ctx.editMessage({ embeds: [successEmbed] });
		} catch (error: any) {
			console.error("[News] command error:", error);
			const errorEmbed = client
				.embed()
				.setColor(client.color.red)
				.setTitle("❌ News Report Failed")
				.setDescription(`Error: ${error?.message || error}`);

			await ctx.editMessage({ embeds: [errorEmbed] });
		}
	}
}