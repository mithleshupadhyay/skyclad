import { pino } from "pino";
import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { settings } from "../config/settings.js";

export const logger = pino({
  level: settings.logLevel,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers['x-api-key']",
      "apiKey",
      "providerApiKey",
      "messages",
      "prompt",
    ],
    censor: "[redacted]",
  },
});

export type RequestWithId = Request & {
  requestId?: string;
};

export function requestLogger(req: RequestWithId, res: Response, next: NextFunction): void {
  const startedAt = Date.now();
  req.requestId = req.headers["x-request-id"]?.toString() || randomUUID();
  res.setHeader("x-request-id", req.requestId);

  res.on("finish", () => {
    logger.info(
      {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        latencyMs: Date.now() - startedAt,
      },
      "http_request_completed",
    );
  });

  next();
}
