import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MikrotikService } from './mikrotik.service';
import { CurrentOrgId } from '../../common/decorators/current-org.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@isp-crm/shared';
import { RegisterRouterInput, UpdateRouterInput } from '@isp-crm/shared';

@ApiTags('MikroTik Routers')
@ApiBearerAuth()
@Controller('routers')
export class RoutersController {
  constructor(private readonly routersService: MikrotikService) {}

  @Get()
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.TECHNICIAN, UserRole.READ_ONLY)
  @ApiOperation({ summary: 'List Managed MikroTik Routers (Tenant Enforced)' })
  async list(@CurrentOrgId() organizationId: string) {
    return this.routersService.listRouters(organizationId);
  }

  @Post()
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN)
  @ApiOperation({ summary: 'Register New MikroTik Router with Encrypted Credentials (Tenant Enforced)' })
  async register(@CurrentOrgId() organizationId: string, @Body() body: RegisterRouterInput) {
    return this.routersService.registerRouter(organizationId, body);
  }

  @Get(':id')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.TECHNICIAN, UserRole.READ_ONLY)
  @ApiOperation({ summary: 'Get MikroTik Router Configuration & Status (Tenant Enforced)' })
  async getById(@CurrentOrgId() organizationId: string, @Param('id') id: string) {
    return this.routersService.getRouterById(organizationId, id);
  }

  @Put(':id')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN)
  @ApiOperation({ summary: 'Update MikroTik Router Details & Re-encrypt Credentials (Tenant Enforced)' })
  async update(
    @CurrentOrgId() organizationId: string,
    @Param('id') id: string,
    @Body() body: UpdateRouterInput,
  ) {
    return this.routersService.updateRouter(organizationId, id, body);
  }

  @Delete(':id')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN)
  @ApiOperation({ summary: 'Remove MikroTik Router & FreeRADIUS NAS Profile (Tenant Enforced)' })
  async delete(@CurrentOrgId() organizationId: string, @Param('id') id: string) {
    return this.routersService.deleteRouter(organizationId, id);
  }

  @Post(':id/test-connection')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.TECHNICIAN)
  @ApiOperation({ summary: 'Test Router Reachability, Credentials & Latency (Tenant Enforced)' })
  async testConnection(@CurrentOrgId() organizationId: string, @Param('id') id: string) {
    return this.routersService.testConnection(organizationId, id);
  }

  @Get(':id/identity')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.TECHNICIAN, UserRole.READ_ONLY)
  @ApiOperation({ summary: 'Query MikroTik Router Identity (Tenant Enforced)' })
  async getIdentity(@CurrentOrgId() organizationId: string, @Param('id') id: string) {
    return this.routersService.getRouterIdentity(organizationId, id);
  }

  @Get(':id/system-resources')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.TECHNICIAN, UserRole.READ_ONLY)
  @ApiOperation({ summary: 'Query MikroTik System Resources, CPU & Memory (Tenant Enforced)' })
  async getSystemResources(@CurrentOrgId() organizationId: string, @Param('id') id: string) {
    return this.routersService.getSystemResources(organizationId, id);
  }

  @Get(':id/active-ppp-sessions')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.TECHNICIAN, UserRole.READ_ONLY)
  @ApiOperation({ summary: 'Query Active PPPoE & PPP Sessions from Router (Tenant Enforced)' })
  async getActivePppSessions(@CurrentOrgId() organizationId: string, @Param('id') id: string) {
    return this.routersService.getActivePppSessions(organizationId, id);
  }

  @Get(':id/interfaces')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.TECHNICIAN, UserRole.READ_ONLY)
  @ApiOperation({ summary: 'Query Router Network Interfaces (Tenant Enforced)' })
  async getInterfaces(@CurrentOrgId() organizationId: string, @Param('id') id: string) {
    return this.routersService.getInterfaces(organizationId, id);
  }

  @Get(':id/interfaces/:interfaceName/traffic')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.TECHNICIAN, UserRole.READ_ONLY)
  @ApiOperation({ summary: 'Query Real-time Rx/Tx Bandwidth Traffic on Interface (Tenant Enforced)' })
  async getInterfaceTraffic(
    @CurrentOrgId() organizationId: string,
    @Param('id') id: string,
    @Param('interfaceName') interfaceName: string,
  ) {
    return this.routersService.getInterfaceTraffic(organizationId, id, interfaceName);
  }
}
