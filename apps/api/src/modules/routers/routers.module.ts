import { Module } from '@nestjs/common';
import { RoutersController } from './routers.controller';
import { MikrotikService } from './mikrotik.service';
import { SstpVpnService } from './sstp-vpn.service';
import {
  MIKROTIK_CLIENT,
  MikrotikClient,
  RouterConnectionConfig,
} from './clients/mikrotik-client.interface';
import { MockMikrotikClient } from './clients/mock-mikrotik.client';
import { RouterOsRestClient } from './clients/routeros-rest.client';
import { RouterOsBinaryClient } from './clients/routeros-binary.client';

@Module({
  controllers: [RoutersController],
  providers: [
    MikrotikService,
    SstpVpnService,
    MockMikrotikClient,
    RouterOsRestClient,
    RouterOsBinaryClient,
    {
      provide: MIKROTIK_CLIENT,
      useFactory: (
        mock: MockMikrotikClient,
        rest: RouterOsRestClient,
        binary: RouterOsBinaryClient,
      ): MikrotikClient => {
        const isMockTarget = (config: RouterConnectionConfig): boolean => {
          // Explicit mock target domain (e.g. bng-01.mock)
          if (config.host.endsWith('.mock')) return true;
          // Explicit global toggle
          if (process.env.USE_MOCK_MIKROTIK === 'true') return true;
          if (process.env.USE_MOCK_MIKROTIK === 'false') return false;
          // Local loopback target in automated container tests
          if (config.host === '127.0.0.1' || config.host === 'localhost') {
            return true;
          }
          return false;
        };

        const selectClient = (config: RouterConnectionConfig): MikrotikClient => {
          if (isMockTarget(config)) {
            return mock;
          }

          // Explicit protocol selection
          if (config.apiMethod === 'BINARY_API' || config.port === 8728 || config.port === 8729) {
            return binary;
          }
          if (config.apiMethod === 'REST_API' || config.port === 80 || config.port === 443) {
            return rest;
          }

          // Default / AUTO: Prefer REST client
          return rest;
        };

        return {
          testConnection: async (config) => {
            if (isMockTarget(config)) {
              return mock.testConnection(config);
            }

            // Explicit Binary API request
            if (config.apiMethod === 'BINARY_API' || config.port === 8728 || config.port === 8729) {
              return binary.testConnection(config);
            }

            // Explicit REST API request
            if (config.apiMethod === 'REST_API') {
              return rest.testConnection(config);
            }

            // AUTO capability detection: Attempt REST probe first
            const restResult = await rest.testConnection(config);
            if (restResult.success) {
              return {
                ...restResult,
                apiMethodUsed: 'REST_API',
                capabilities: {
                  rest: true,
                  binaryApi: true,
                  sstp: true,
                  coa: true,
                },
              };
            }

            // If REST returned 404, connection refused, or timeout and port might be binary API, attempt binary API probe
            const binaryConfig = { ...config, port: config.port === 80 || config.port === 443 ? 8728 : config.port };
            const binaryResult = await binary.testConnection(binaryConfig);
            if (binaryResult.success) {
              return binaryResult;
            }

            // Return original failure if both fail
            return restResult;
          },

          getRouterIdentity: async (config) => {
            const client = selectClient(config);
            try {
              return await client.getRouterIdentity(config);
            } catch (err) {
              if (client === rest && !isMockTarget(config)) {
                return binary.getRouterIdentity(config);
              }
              throw err;
            }
          },

          getSystemResources: async (config) => {
            const client = selectClient(config);
            try {
              return await client.getSystemResources(config);
            } catch (err) {
              if (client === rest && !isMockTarget(config)) {
                return binary.getSystemResources(config);
              }
              throw err;
            }
          },

          getActivePppSessions: async (config) => {
            const client = selectClient(config);
            try {
              return await client.getActivePppSessions(config);
            } catch (err) {
              if (client === rest && !isMockTarget(config)) {
                return binary.getActivePppSessions(config);
              }
              throw err;
            }
          },

          getInterfaces: async (config) => {
            const client = selectClient(config);
            try {
              return await client.getInterfaces(config);
            } catch (err) {
              if (client === rest && !isMockTarget(config)) {
                return binary.getInterfaces(config);
              }
              throw err;
            }
          },

          getInterfaceTraffic: async (config, iface) => {
            const client = selectClient(config);
            try {
              return await client.getInterfaceTraffic(config, iface);
            } catch (err) {
              if (client === rest && !isMockTarget(config)) {
                return binary.getInterfaceTraffic(config, iface);
              }
              throw err;
            }
          },
        };
      },
      inject: [MockMikrotikClient, RouterOsRestClient, RouterOsBinaryClient],
    },
  ],
  exports: [
    MikrotikService,
    SstpVpnService,
    MIKROTIK_CLIENT,
    MockMikrotikClient,
    RouterOsRestClient,
    RouterOsBinaryClient,
  ],
})
export class RoutersModule {}
