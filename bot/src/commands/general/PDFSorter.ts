import { Command, type Context, type Lavamusic } from "../../structures/index";
import { EmbedLinks, ReadMessageHistory, SendMessages, ViewChannel } from "../../utils/Permissions";
import { ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType, EmbedBuilder } from "discord.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export default class PDFSorter extends Command {
	constructor(client: Lavamusic) {
		super(client, {
			name: "pdfsort",
			description: {
				content: "Manually trigger PDF sorting from UnsortedPDF to UniWork",
				usage: "pdfsort",
				examples: ["pdfsort"],
			},
			category: "general",
			aliases: ["sortpdf", "pdf-sort"],
			cooldown: 10,
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
		const embed = client.embed()
			.setColor(client.color.main)
			.setDescription("🔄 Starting PDF sort...");

		const msg = await ctx.sendMessage({ embeds: [embed] });

		try {
			const { stdout, stderr } = await execAsync("python3 /home/regator47/pdf_sorter.py", {
				timeout: 120000,
				maxBuffer: 1024 * 1024
			});

			const result = JSON.parse(stdout.trim().split('\n').pop() || '{}');
			
			const summaryEmbed = client.embed()
				.setColor(result.errors > 0 ? client.color.red : client.color.green)
				.setTitle("📁 PDF Sort Results")
				.setDescription(
					`✅ Moved: **${result.moved || 0}**\n` +
					`⏭️ Skipped: **${result.skipped || 0}**\n` +
					`❌ Errors: **${result.errors || 0}**`
				)
				.setFooter({ text: `Completed at ${new Date().toLocaleString()}` });

			if (result.details && result.details.length > 0) {
				const details = result.details.slice(0, 10).map((d: any) => 
					`${d.success ? '✅' : '❌'} ${d.file}: ${d.message}`
				).join('\n');
				summaryEmbed.addFields({ name: "Details", value: details.slice(0, 1024) });
			}

			const checkAgainBtn = new ButtonBuilder()
				.setCustomId("pdf_sorter_check_again")
				.setLabel("🔄 Check Again")
				.setStyle(ButtonStyle.Primary);

			const row = new ActionRowBuilder<ButtonBuilder>().addComponents(checkAgainBtn);

			await msg.edit({ embeds: [summaryEmbed], components: [row] });

		} catch (error) {
			const errorEmbed = client.embed()
				.setColor(client.color.red)
				.setTitle("❌ PDF Sort Failed")
				.setDescription(`Error: ${error.message}`);

			await msg.edit({ embeds: [errorEmbed] });
		}
	}
}