import { existsSync } from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import express from "express";
import { Server } from "socket.io";
import { enabledFeatures } from "../features.js";
import { createContext } from "./context.js";

export async function createApp({ config, logger }) {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: false }, maxHttpBufferSize: 2e6 });
  const ctx = createContext({ config, logger, app, httpServer, io });

  const distHtml = path.join(config.FRONTEND_DIR, "dist", "index.html");
  const staticDir = existsSync(distHtml) ? path.join(config.FRONTEND_DIR, "dist") : config.FRONTEND_DIR;

  app.use(express.json({ limit: "100kb" }));
  app.use(express.static(staticDir, { index: false }));
  app.get("/", (_req, res) => {
    res.sendFile(existsSync(distHtml) ? distHtml : path.join(config.FRONTEND_DIR, "index.html"));
  });

  for (const feature of enabledFeatures) {
    if (typeof feature.init === "function") await feature.init(ctx);
  }
  for (const feature of enabledFeatures) {
    if (typeof feature.http === "function") feature.http(ctx);
  }
  for (const feature of enabledFeatures) {
    if (typeof feature.sockets === "function") feature.sockets(ctx);
  }

  io.on("connection", (socket) => {
    ctx.bindSocket(socket);
  });

  return ctx;
}
