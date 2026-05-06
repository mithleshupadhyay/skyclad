import type { Settings } from "../config/settings.js";
import { initializeDatabase, openDatabase, type DatabaseClient } from "../db/database.js";
import { CacheRepository } from "../db/cacheRepository.js";
import { CircuitBreakerRepository } from "../db/circuitBreakerRepository.js";
import { FailureInjectionRepository } from "../db/failureInjectionRepository.js";
import { ProviderRepository } from "../db/providerRepository.js";
import { RequestRepository } from "../db/requestRepository.js";
import { TenantRepository } from "../db/tenantRepository.js";
import { ProviderRegistry } from "../providers/registry.js";
import { ProviderExecutor } from "../resilience/providerExecutor.js";
import { RoutingService } from "../routing/routingService.js";
import { GatewayService } from "./gatewayService.js";

export type ServiceContainer = {
  db: DatabaseClient;
  tenantRepository: TenantRepository;
  providerRepository: ProviderRepository;
  requestRepository: RequestRepository;
  cacheRepository: CacheRepository;
  circuitBreakerRepository: CircuitBreakerRepository;
  failureInjectionRepository: FailureInjectionRepository;
  providerRegistry: ProviderRegistry;
  routingService: RoutingService;
  providerExecutor: ProviderExecutor;
  gatewayService: GatewayService;
};

export function createContainer(settings: Settings): ServiceContainer {
  const db = openDatabase(settings.databasePath);
  initializeDatabase(db, settings);

  const tenantRepository = new TenantRepository(db);
  const providerRepository = new ProviderRepository(db);
  const requestRepository = new RequestRepository(db);
  const cacheRepository = new CacheRepository(db);
  const circuitBreakerRepository = new CircuitBreakerRepository(db);
  const failureInjectionRepository = new FailureInjectionRepository(db);
  const providerRegistry = new ProviderRegistry(settings);
  const routingService = new RoutingService(providerRepository, tenantRepository, providerRegistry);
  const providerExecutor = new ProviderExecutor(
    settings,
    providerRegistry,
    providerRepository,
    requestRepository,
    circuitBreakerRepository,
    failureInjectionRepository,
  );
  const gatewayService = new GatewayService(
    settings,
    routingService,
    providerRepository,
    tenantRepository,
    requestRepository,
    cacheRepository,
    providerExecutor,
  );

  return {
    db,
    tenantRepository,
    providerRepository,
    requestRepository,
    cacheRepository,
    circuitBreakerRepository,
    failureInjectionRepository,
    providerRegistry,
    routingService,
    providerExecutor,
    gatewayService,
  };
}
