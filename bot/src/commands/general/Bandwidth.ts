import { Command, type Context, type Lavamusic } from "../../structures/index";
import { EmbedLinks, ReadMessageHistory, SendMessages, ViewChannel } from "../../utils/Permissions";

export default class Bandwidth extends Command {
	constructor(client: Lavamusic) {
		super(client, {
			name: "bandwidth",
			description: {
				content: "Check upload and download bandwidth",
				usage: "bandwidth",
				examples: ["bandwidth"],
			},
			category: "general",
			aliases: ["bw", "speed"],
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
		const embed = client.embed().setColor(client.color.main).setDescription("Running bandwidth test...");

		const msg = await ctx.sendMessage({ embeds: [embed] });

		try {
			// Download test: fetch a 10MB file
			const downloadStart = Date.now();
			const dlRes = await fetch("https://speed.cloudflare.com/__down?bytes=10000000", {
				signal: AbortSignal.timeout(30000),
			});
			const dlData = await dlRes.arrayBuffer();
			const downloadMs = Date.now() - downloadStart;
			const downloadMbps = ((dlData.byteLength * 8) / (downloadMs / 1000) / 1_000_000).toFixed(2);

			// Upload test: POST 5MB of data
			const uploadSize = 5_000_000;
			const uploadData = new Uint8Array(uploadSize);
			globalThis.crypto.getRandomValues(uploadData);
			const uploadStart = Date.now();
			await fetch("https://speed.cloudflare.com/__up", {
				method: "POST",
				body: uploadData,
				signal: AbortSignal.timeout(30000),
			});
			const uploadMs = Date.now() - uploadStart;
			const uploadMbps = ((uploadSize * 8) / (uploadMs / 1000) / 1_000_000).toFixed(2);

			// Ping test
			const pingStart = Date.now();
			await fetch("https://speed.cloudflare.com/__ping", { signal: AbortSignal.timeout(5000) });
			const pingMs = Date.now() - pingStart;

			const resultEmbed = client
				.embed()
				.setColor(client.color.green)
				.setTitle("Bandwidth Test Results")
				.addFields(
					{ name: "Download", value: `**${downloadMbps}** Mbps`, inline: true },
					{ name: "Upload", value: `**${uploadMbps}** Mbps`, inline: true },
					{ name: "Ping", value: `**${pingMs}** ms`, inline: true },
				)
				.setFooter({ text: "Tested via Cloudflare" })
				.setTimestamp();

			return await msg.edit({ embeds: [resultEmbed] });
		} catch (e: any) {
			return await msg.edit({
				embeds: [
					client
						.embed()
						.setColor(client.color.red)
						.setDescription(`Bandwidth test failed: ${e?.message || "Unknown error"}`),
				],
			});
		}
	}
}
