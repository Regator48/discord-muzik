import fs from "node:fs";
import path from "node:path";

const CONFIG_FILE = path.join(process.cwd(), "channel-links.json");

interface ChannelLinksConfig {
	links: string[][];
}

function loadConfig(): ChannelLinksConfig {
	if (fs.existsSync(CONFIG_FILE)) {
		return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
	}
	return { links: [] };
}

function saveConfig(config: ChannelLinksConfig): void {
	fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getLinkedChannels(sourceChannelId: string): string[] {
	const config = loadConfig();
	for (const link of config.links) {
		if (link.includes(sourceChannelId)) {
			return link.filter((ch) => ch !== sourceChannelId);
		}
	}
	return [];
}

export function linkChannels(channelId: string, targetChannelId: string): boolean {
	const config = loadConfig();
	const linked = getLinkedChannels(channelId);
	if (linked.includes(targetChannelId)) return false;

	for (const link of config.links) {
		if (link.includes(channelId)) {
			link.push(targetChannelId);
			saveConfig(config);
			return true;
		}
	}

	config.links.push([channelId, targetChannelId]);
	saveConfig(config);
	return true;
}

export function unlinkChannels(channelId: string, targetChannelId: string): boolean {
	const config = loadConfig();
	for (const link of config.links) {
		if (link.includes(channelId) && link.includes(targetChannelId)) {
			const idx = link.indexOf(targetChannelId);
			if (idx !== -1) link.splice(idx, 1);
			if (link.length <= 1) {
				config.links = config.links.filter((l) => l !== link);
			}
			saveConfig(config);
			return true;
		}
	}
	return false;
}
