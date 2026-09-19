import type { ButtonInteraction } from "discord.js";
import { Component, type Lavamusic } from "../../structures";
import { EmbedBuilder } from "discord.js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export default class PDFSorterDuplicate extends Component {
	constructor(client: Lavamusic) {
		super(client, {
			name: "pdf_dup_",
		});
	}

	private getDupId(filename: string): string {
		return crypto.createHash("sha256").update(filename).digest("hex").substring(0, 8);
	}

	private parseDupId(customId: string): string | null {
		const match = customId.match(/^pdf_dup_(keep|replace|skip)_([a-f0-9]{8})$/);
		return match ? match[1] : null;
	}

	private findMessageByDupId(interaction: ButtonInteraction, dupId: string): Promise<any> | null {
		return interaction.channel?.messages.fetch().then((messages) => {
			for (const [, msg] of messages) {
				if (msg.content?.startsWith("DUP_DATA|")) {
					const parts = msg.content.split("|");
					if (parts.length >= 2 && parts[1] === dupId && parts.length >= 4) {
						return msg;
					} else if (parts.length >= 4) {
						// Try filename match
						const filename = parts[1];
						if (this.getDupId(filename) === dupId) {
							return msg;
						}
					}
				}
			}
			return null;
		}).catch(() => null);
	}

	public async run(interaction: ButtonInteraction): Promise<any> {
		const customId = interaction.customId;
		console.log(`[PDFSorter] Button clicked: ${customId}`);

		const actionMatch = customId.match(/^pdf_dup_(keep|replace|skip)_(.+)$/);
		if (!actionMatch) {
			await interaction.reply({
				embeds: [new EmbedBuilder().setColor(this.client.color.red).setDescription("❌ Invalid button format")],
				ephemeral: true
			});
			return;
		}

		const action = actionMatch[1];
		const dupId = actionMatch[2];
		console.log(`[PDFSorter] Action: ${action}, DupID: ${dupId}`);

		await interaction.deferUpdate();
		console.log(`[PDFSorter] DeferUpdate done for ${customId}`);

		let entry: { filename: string; sourcePath: string; targetPath: string } | null = null;

		try {
			const channel = await this.client.channels.fetch(interaction.channelId);
			if (!channel?.isTextBased()) throw new Error("Channel not found");

			// Find message with matching dupId
			const message = await channel.messages.fetch({ limit: 100 }).then((messages) => {
				for (const [, m] of messages) {
					if (m.content?.startsWith("DUP_DATA|")) {
						const parts = m.content.split("|");
						console.log(`[PDFSorter] Checking message content: ${m.content.substring(0, 50)}`);
						if (parts.length >= 4) {
							const msgId = parts[1];
							const msgFilename = parts[2];
							const msgDupId = msgId || this.getDupId(msgFilename);
							console.log(`[PDFSorter] Message dupId from content: ${msgDupId}, looking for: ${dupId}`);
							if (msgDupId === dupId) {
								return { content: m.content, message: m };
							}
						}
					}
				}
				return null;
			});

			console.log(`[PDFSorter] Found message:`, message ? "yes" : "no");

			if (message) {
				const parts = message.content.split("|");
				if (parts.length >= 4) {
					// Try to parse as filename-based dup_id first
					const filename = parts[1];
					const calculatedDupId = this.getDupId(filename);
					
					// If it matches, use that; otherwise try to parse from parts[1]
					if (calculatedDupId === dupId || parts[1] === dupId) {
						entry = {
							filename: parts[1] || parts[2], // filename might be at index 1 or 2
							sourcePath: parts[parts.length - 2],
							targetPath: parts[parts.length - 1]
						};
						console.log(`[PDFSorter] Parsed entry: filename=${entry.filename}, source=${entry.sourcePath}, target=${entry.targetPath}`);
					}
				}
			}
		} catch (error) {
			console.error("[PDFSorter] Error fetching message:", error);
		}

		if (!entry) {
			await interaction.editReply({
				embeds: [new EmbedBuilder()
					.setColor(this.client.color.red)
					.setDescription(`❌ Duplicate info not found. ID: ${dupId}\nThe message may have been deleted or the file was already processed.`)],
				components: []
			});
			return;
		}

		const { filename, sourcePath, targetPath } = entry;
		const unsortedDir = "/var/www/html/data/Regator47/files/Downloads/UnsortedPDF";
		const fullSourcePath = path.join(unsortedDir, filename);

		console.log(`[PDFSorter] Checking if source exists: ${fullSourcePath}`);
		console.log(`[PDFSorter] Source exists: ${fs.existsSync(fullSourcePath)}`);

		if (!fs.existsSync(fullSourcePath)) {
			await interaction.editReply({
				embeds: [new EmbedBuilder()
					.setColor(this.client.color.red)
					.setDescription(`❌ Source file not found: \`${filename}\`\nPath: ${fullSourcePath}`)],
				components: []
			});
			return;
		}

		try {
			if (action === "keep") {
				await this.handleKeepBoth(interaction, filename, fullSourcePath, targetPath);
			} else if (action === "replace") {
				await this.handleReplace(interaction, filename, fullSourcePath, targetPath);
			} else if (action === "skip") {
				await this.handleSkip(interaction, filename, fullSourcePath);
			}
		} catch (error) {
			console.error(`[PDFSorter] Error in ${action}:`, error);
			await interaction.editReply({
				embeds: [new EmbedBuilder()
					.setColor(this.client.color.red)
					.setDescription(`❌ Error: ${error.message}\nPath: ${fullSourcePath}`)],
				components: []
			});
		}
	}

	private async handleKeepBoth(interaction: ButtonInteraction, filename: string, sourcePath: string, targetPath: string): Promise<void> {
		const targetDir = path.dirname(targetPath);
		const baseName = path.parse(filename).name;
		const ext = path.parse(filename).ext;
		let counter = 1;
		let newFilename = filename;
		
		while (fs.existsSync(path.join(targetDir, newFilename))) {
			newFilename = `${baseName}_${counter}${ext}`;
			counter++;
		}
		
		const newTargetPath = path.join(targetDir, newFilename);
		fs.renameSync(sourcePath, newTargetPath);

		const embed = new EmbedBuilder()
			.setColor(this.client.color.green)
			.setTitle("✅ Kept Both Files")
			.setDescription(`Renamed to: **${newFilename}**\nMoved to: \`${targetDir}\``);

		await interaction.editReply({ embeds: [embed], components: [] });
	}

	private async handleReplace(interaction: ButtonInteraction, filename: string, sourcePath: string, targetPath: string): Promise<void> {
		fs.unlinkSync(targetPath);
		fs.renameSync(sourcePath, targetPath);

		const embed = new EmbedBuilder()
			.setColor(this.client.color.green)
			.setTitle("🔄 Replaced File")
			.setDescription(`Replaced: **${filename}**\nMoved to: \`${path.dirname(targetPath)}\``);

		await interaction.editReply({ embeds: [embed], components: [] });
	}

	private async handleSkip(interaction: ButtonInteraction, filename: string, sourcePath: string): Promise<void> {
		fs.unlinkSync(sourcePath);

		const embed = new EmbedBuilder()
			.setColor(this.client.color.yellow)
			.setTitle("⏭️ Skipped & Removed")
			.setDescription(`Deleted from UnsortedPDF: **${filename}**`);

		await interaction.editReply({ embeds: [embed], components: [] });
	}
}