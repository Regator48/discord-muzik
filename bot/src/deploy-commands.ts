import Lavamusic from "./structures/Lavamusic";
import { env } from "./env";
import { initI18n } from "./structures/I18n";

const client = new Lavamusic({ intents: [1] }) as any;

client.once("ready", async () => {
	try {
		await initI18n();
		await client.loadCommands();
		await client.syncCommands(env.GUILD_ID || undefined);
		console.log("✅ Slash commands deployed!");
	} catch (e) {
		console.error("Deploy failed:", e);
		process.exitCode = 1;
	} finally {
		client.destroy();
		process.exit(process.exitCode ?? 0);
	}
});

client.login(env.TOKEN);
