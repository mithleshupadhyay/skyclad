import { createApp } from "./app.js";
import { settings } from "./config/settings.js";
import { logger } from "./logging/logger.js";

const { app } = createApp(settings);

const server = app.listen(settings.port, () => {
  logger.info({ port: settings.port }, "llm_gateway_started");
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    logger.error(
      { port: settings.port },
      "port_in_use_start_failed",
    );
    process.stderr.write(
      `Port ${settings.port} is already in use. Stop the existing process or start with PORT=3010 npm run dev.\n`,
    );
    process.exit(1);
  }

  logger.error({ error }, "llm_gateway_start_failed");
  process.exit(1);
});
