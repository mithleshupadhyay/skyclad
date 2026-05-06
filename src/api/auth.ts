import type { NextFunction, Request, Response } from "express";
import type { TenantRepository } from "../db/tenantRepository.js";
import type { ApiKeyContext } from "../domain/types.js";
import { AppError } from "../domain/errors.js";

export type AuthenticatedRequest = Request & {
  auth?: ApiKeyContext;
};

export function authenticateTenant(tenantRepository: TenantRepository) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;
    const apiKey = req.headers["x-api-key"]?.toString() || bearerToken;

    if (!apiKey) {
      next(new AppError(401, "missing_api_key", "Provide a tenant API key with Authorization: Bearer or x-api-key."));
      return;
    }

    const context = tenantRepository.findByApiKey(apiKey);
    if (!context) {
      next(new AppError(401, "invalid_api_key", "Tenant API key is invalid or inactive."));
      return;
    }

    req.auth = context;
    next();
  };
}
