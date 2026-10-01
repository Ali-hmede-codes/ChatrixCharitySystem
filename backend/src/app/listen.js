const ALREADY_RUNNING = 78;

export function listen(ctx) {
  const { httpServer, config } = ctx;
  const port = Number(config.PORT);
  const host = config.HOST;

  const onError = (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use. Another copy of ${config.APP_NAME} is still running.`);
      console.error("Stop that copy, then start only its PM2 process:");
      console.error(`  sudo pm2 stop ${config.APP_NAME}`);
      console.error(`  sudo fuser -k ${port}/tcp ${config.LOCK_PORT}/tcp`);
      console.error("  sudo pm2 start ecosystem.config.cjs");
      process.exit(ALREADY_RUNNING);
    }
    console.error(error);
    process.exit(1);
  };

  httpServer.once("error", onError);
  httpServer.listen({ port, host, exclusive: true }, () => {
    httpServer.off("error", onError);
    ctx.httpPort = port;
    console.log(`Chatrix Charity System is running at http://${host}:${port}`);
    ctx.emitListening();
  });
}
