import express from "express";
import helmet from "helmet";
import type { Settings } from "./config/settings.js";
import { settings as defaultSettings } from "./config/settings.js";
import { createContainer, type ServiceContainer } from "./services/container.js";
import { createRouter } from "./api/routes.js";
import { errorHandler, notFoundHandler } from "./api/errorHandler.js";
import { requestLogger } from "./logging/logger.js";
import { httpRequestCounter } from "./metrics/metrics.js";

export type AppContext = {
  app: express.Express;
  container: ServiceContainer;
};

export function createApp(settings: Settings = defaultSettings): AppContext {
  const app = express();
  const container = createContainer(settings);

  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));
  app.use(requestLogger);
  app.use((req, res, next) => {
    res.on("finish", () => {
      httpRequestCounter.inc({
        method: req.method,
        route: req.route?.path?.toString() || req.path,
        status_code: res.statusCode.toString(),
      });
    });
    next();
  });

  app.use(createRouter(container));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app, container };
}
