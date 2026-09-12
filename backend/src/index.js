import { createApp } from "./app/create-app.js";
import { listen } from "./app/listen.js";
import { acquireLock } from "./app/lock.js";
import { config } from "./config.js";
import { logger } from "./infrastructure/logger.js";

const ctx = await createApp({ config, logger });

acquireLock({
  host: config.HOST,
  port: config.LOCK_PORT,
  onTaken() {
    console.error("Chatrix Charity System is already running in another terminal.");
    console.error("Close the extra npm start windows, then open only one: http://127.0.0.1:4173");
    process.exit(1);
  },
  onFree() {
    listen(ctx);
  },
});

process.on("SIGINT", async () => {
  try {
    await ctx.services.whatsapp?.shutdown?.();
  } catch {
    // Ignore.
  }
  process.exit(0);
});
