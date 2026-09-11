import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RadiusService } from './radius.service';
import { CurrentOrgId } from '../../common/decorators/current-org.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@isp-crm/shared';

@ApiTags('FreeRADIUS & Sessions')
@ApiBearerAuth()
@Controller('radius')
export class RadiusController {
  constructor(private readonly radiusService: RadiusService) {}

  @Get('sessions/active')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.TECHNICIAN, UserRole.SUPPORT, UserRole.READ_ONLY)
  @ApiOperation({ summary: 'List Real-Time Active PPPoE Sessions from radacct (Tenant Enforced)' })
  async getActiveSessions(
    @CurrentOrgId() organizationId: string,
    @Query('username') username?: string,
  ) {
    return this.radiusService.getActiveSessions(organizationId, { username });
  }

  @Post('sessions/:sessionId/disconnect')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.TECHNICIAN)
  @ApiOperation({ summary: 'Dispatch RFC 3576 Disconnect-Request (PoD) to Router (Tenant Enforced)' })
  async disconnectSession(
    @CurrentOrgId() organizationId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.radiusService.disconnectSession(organizationId, sessionId);
  }

  @Get('users/:username/sessions')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.TECHNICIAN, UserRole.SUPPORT, UserRole.READ_ONLY)
  @ApiOperation({ summary: 'Historical PPPoE Session Accounting for User (Tenant Enforced)' })
  async getUserSessions(
    @CurrentOrgId() organizationId: string,
    @Param('username') username: string,
  ) {
    return this.radiusService.getUserSessions(organizationId, username);
  }
}
