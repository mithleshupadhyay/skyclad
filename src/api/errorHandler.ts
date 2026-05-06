import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../domain/errors.js";
import { logger } from "../logging/logger.js";

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: "not_found",
      message: `No route found for ${req.method} ${req.path}.`,
    },
  });
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "validation_error",
        message: "Request validation failed.",
        details: error.flatten(),
      },
    });
    return;
  }

  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
    return;
  }

  logger.error({ error }, "unhandled_error");
  res.status(500).json({
    error: {
      code: "internal_error",
      message: "Internal server error.",
    },
  });
}
