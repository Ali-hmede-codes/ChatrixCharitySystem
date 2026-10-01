import "./infrastructure/websocket.js";
import { createApp } from "./app/create-app.js";
import { listen } from "./app/listen.js";
import { acquireLock } from "./app/lock.js";
import { config } from "./config.js";
import { logger } from "./infrastructure/logger.js";

const ctx = await createApp({ config, logger });

acquireLock({
  host: "127.0.0.1",
  port: config.LOCK_PORT,
  onTaken() {
    console.error(`${config.APP_NAME} is already running in another process.`);
    console.error("That leftover copy keeps this site up after `pm2 stop`.");
    console.error("Stop that copy, then start only its PM2 process:");
    console.error(`  sudo pm2 stop ${config.APP_NAME}`);
    console.error(`  sudo fuser -k ${config.PORT}/tcp ${config.LOCK_PORT}/tcp`);
    console.error("  sudo pm2 start ecosystem.config.cjs");
    process.exit(78);
  },
  onFree() {
    listen(ctx);
  },
});

async function shutdown() {
  try {
    await ctx.services.whatsapp?.shutdown?.();
  } catch {
    // Ignore.
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
