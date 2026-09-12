export function listen(ctx) {
  const { httpServer, config } = ctx;
  let httpStarted = false;

  function bind(port) {
    const onError = (error) => {
      if (error.code === "EADDRINUSE" && port === 4173 && !httpStarted) {
        bind(4174);
        return;
      }
      if (!httpStarted) {
        console.error(error);
        process.exit(1);
      }
    };

    httpServer.once("error", onError);
    httpServer.listen({ port, host: config.HOST, exclusive: true }, () => {
      if (httpStarted) return;
      httpStarted = true;
      ctx.httpPort = port;
      httpServer.off("error", onError);
      console.log(`Chatrix Charity System is running at http://${config.HOST}:${port}`);
      ctx.emitListening();
    });
  }

  bind(config.PORT);
}
