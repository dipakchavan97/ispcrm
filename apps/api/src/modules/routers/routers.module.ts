import { Module } from '@nestjs/common';
import { RoutersController } from './routers.controller';
import { MikrotikService } from './mikrotik.service';
import {
  MIKROTIK_CLIENT,
  MikrotikClient,
  RouterConnectionConfig,
} from './clients/mikrotik-client.interface';
import { MockMikrotikClient } from './clients/mock-mikrotik.client';
import { RouterOsRestClient } from './clients/routeros-rest.client';

@Module({
  controllers: [RoutersController],
  providers: [
    MikrotikService,
    MockMikrotikClient,
    RouterOsRestClient,
    {
      provide: MIKROTIK_CLIENT,
      useFactory: (mock: MockMikrotikClient, rest: RouterOsRestClient): MikrotikClient => {
        const isMockTarget = (config: RouterConnectionConfig): boolean => {
          if (config.host.endsWith('.mock')) return true;
          if (process.env.USE_MOCK_MIKROTIK === 'true') return true;
          if (process.env.NODE_ENV === 'test') return true;
          if (process.env.NODE_ENV !== 'production' && process.env.USE_MOCK_MIKROTIK !== 'false') return true;
          return false;
        };

        return {
          testConnection: (config) =>
            isMockTarget(config) ? mock.testConnection(config) : rest.testConnection(config),
          getRouterIdentity: (config) =>
            isMockTarget(config) ? mock.getRouterIdentity(config) : rest.getRouterIdentity(config),
          getSystemResources: (config) =>
            isMockTarget(config) ? mock.getSystemResources(config) : rest.getSystemResources(config),
          getActivePppSessions: (config) =>
            isMockTarget(config) ? mock.getActivePppSessions(config) : rest.getActivePppSessions(config),
          getInterfaces: (config) =>
            isMockTarget(config) ? mock.getInterfaces(config) : rest.getInterfaces(config),
          getInterfaceTraffic: (config, iface) =>
            isMockTarget(config)
              ? mock.getInterfaceTraffic(config, iface)
              : rest.getInterfaceTraffic(config, iface),
        };
      },
      inject: [MockMikrotikClient, RouterOsRestClient],
    },
  ],
  exports: [MikrotikService, MIKROTIK_CLIENT, MockMikrotikClient, RouterOsRestClient],
})
export class RoutersModule {}
