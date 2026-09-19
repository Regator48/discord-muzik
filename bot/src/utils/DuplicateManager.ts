import fs from "node:fs";
import path from "node:path";

const DUPLICATE_STORE = path.join(process.cwd(), "pdf_duplicates.json");

interface DuplicateEntry {
	filename: string;
	sourcePath: string;
	targetPath: string;
	messageId: string;
	channelId: string;
	timestamp: number;
}

function loadStore(): Record<string, DuplicateEntry> {
	if (fs.existsSync(DUPLICATE_STORE)) {
		try {
			return JSON.parse(fs.readFileSync(DUPLICATE_STORE, "utf-8"));
		} catch {
			return {};
		}
	}
	return {};
}

function saveStore(store: Record<string, DuplicateEntry>): void {
	fs.writeFileSync(DUPLICATE_STORE, JSON.stringify(store, null, 2));
}

export function storeDuplicate(
	messageId: string,
	channelId: string,
	filename: string,
	sourcePath: string,
	targetPath: string
): void {
	const store = loadStore();
	store[messageId] = {
		filename,
		sourcePath,
		targetPath,
		messageId,
		channelId,
		timestamp: Date.now(),
	};
	saveStore(store);
}

export function getDuplicate(messageId: string): DuplicateEntry | null {
	const store = loadStore();
	return store[messageId] || null;
}

export function removeDuplicate(messageId: string): void {
	const store = loadStore();
	delete store[messageId];
	saveStore(store);
}

export function cleanupOldEntries(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
	const store = loadStore();
	const now = Date.now();
	for (const [msgId, entry] of Object.entries(store)) {
		if (now - entry.timestamp > maxAgeMs) {
			delete store[msgId];
		}
	}
	saveStore(store);
}