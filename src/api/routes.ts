import { Router } from "express";
import type { ServiceContainer } from "../services/container.js";
import { chatCompletionRequestSchema, failureInjectionRequestSchema, providerNameSchema } from "../schemas/chatSchemas.js";
import { mapChatRequest } from "../schemas/mapper.js";
import { authenticateTenant, type AuthenticatedRequest } from "./auth.js";
import { metricsContentType, metricsText } from "../metrics/metrics.js";
import { setupSse, writeSse } from "./sse.js";
import { AppError } from "../domain/errors.js";

export function createRouter(container: ServiceContainer): Router {
  const router = Router();
  const auth = authenticateTenant(container.tenantRepository);

  router.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  router.get("/metrics", async (_req, res, next) => {
    try {
      res.setHeader("Content-Type", metricsContentType());
      res.send(await metricsText());
    } catch (error) {
      next(error);
    }
  });

  router.get("/v1/providers", auth, (req: AuthenticatedRequest, res, next) => {
    try {
      const tenantId = req.auth?.tenant.id;
      if (!tenantId) {
        throw new AppError(401, "missing_auth_context", "Missing tenant auth context.");
      }

      const allowlist = new Set(container.tenantRepository.listAllowedProviders(tenantId));
      const providers = container.providerRepository.listEnabledProviders().map((provider) => ({
        provider_name: provider.providerName,
        display_name: provider.displayName,
        allowed: allowlist.has(provider.providerName),
        configured: container.providerRegistry.isConfigured(provider.providerName),
        default_model: provider.defaultModel,
        cheap_model: provider.cheapModel,
        premium_model: provider.premiumModel,
        prompt_cost_per_1k_cents: provider.promptCostPer1kCents,
        completion_cost_per_1k_cents: provider.completionCostPer1kCents,
      }));

      res.json({ providers });
    } catch (error) {
      next(error);
    }
  });

  router.post("/v1/chat/completions", auth, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.auth) {
        throw new AppError(401, "missing_auth_context", "Missing tenant auth context.");
      }

      const parsed = chatCompletionRequestSchema.parse(req.body);
      const body = mapChatRequest(parsed);

      if (body.stream) {
        setupSse(res);
        for await (const event of container.gatewayService.stream(req.auth, body)) {
          writeSse(res, event);
        }
        res.end();
        return;
      }

      const response = await container.gatewayService.complete(req.auth, body);
      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  router.get("/v1/usage", auth, (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.auth) {
        throw new AppError(401, "missing_auth_context", "Missing tenant auth context.");
      }

      const since = req.query.since?.toString();
      const summary = container.requestRepository.getUsageSummary(req.auth.tenant.id, since);
      res.json(summary);
    } catch (error) {
      next(error);
    }
  });

  router.get("/v1/circuit-breakers", auth, (_req, res) => {
    res.json({ providers: container.circuitBreakerRepository.list() });
  });

  router.post("/v1/circuit-breakers/:provider/reset", auth, (req, res, next) => {
    try {
      const providerName = providerNameSchema.parse(req.params.provider);
      container.circuitBreakerRepository.reset(providerName);
      res.json({ provider: container.circuitBreakerRepository.get(providerName) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/v1/failure-injections", auth, (_req, res) => {
    res.json({ providers: container.failureInjectionRepository.list() });
  });

  router.post("/v1/failure-injections/:provider", auth, (req, res, next) => {
    try {
      const providerName = providerNameSchema.parse(req.params.provider);
      const parsed = failureInjectionRequestSchema.parse(req.body);
      const injection = container.failureInjectionRepository.set({
        providerName,
        mode: parsed.mode,
        remainingCount: parsed.mode === "none" ? 0 : parsed.remaining_count,
        latencyMs: parsed.latency_ms,
        statusCode: parsed.status_code,
        streamDropAfterChunks: parsed.stream_drop_after_chunks,
      });

      res.json({ provider: injection });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
