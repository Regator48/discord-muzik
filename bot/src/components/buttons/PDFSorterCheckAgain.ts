import type { ButtonInteraction } from "discord.js";
import { Component, type Lavamusic } from "../../structures";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from "discord.js";

const execAsync = promisify(exec);

export default class PDFSorterCheckAgain extends Component {
	constructor(client: Lavamusic) {
		super(client, {
			name: "pdf_sorter_check_again",
		});
	}

	public async run(interaction: ButtonInteraction): Promise<any> {
		await interaction.deferUpdate();

		const embed = new EmbedBuilder()
			.setColor(this.client.color.main)
			.setDescription("🔄 Re-running PDF sort...");

		await interaction.editReply({ embeds: [embed], components: [] });

		try {
			const { stdout } = await execAsync("python3 /home/regator47/pdf_sorter.py", {
				timeout: 120000,
				maxBuffer: 1024 * 1024
			});

			const result = JSON.parse(stdout.trim().split('\n').pop() || '{}');
			
			const summaryEmbed = new EmbedBuilder()
				.setColor(result.errors > 0 ? this.client.color.red : this.client.color.green)
				.setTitle("📁 PDF Sort Results (Re-check)")
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

			await interaction.editReply({ embeds: [summaryEmbed], components: [row] });

		} catch (error) {
			const errorEmbed = new EmbedBuilder()
				.setColor(this.client.color.red)
				.setTitle("❌ PDF Sort Failed")
				.setDescription(`Error: ${error.message}`);

			await interaction.editReply({ embeds: [errorEmbed] });
		}
	}
}