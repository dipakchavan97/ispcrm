import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { CurrentOrgId } from '../../common/decorators/current-org.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@isp-crm/shared';

@ApiTags('Audit Logs')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.READ_ONLY)
  @ApiOperation({ summary: 'List Administrative Audit Logs (Tenant Enforced)' })
  async list(
    @CurrentOrgId() organizationId: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
  ) {
    return this.auditService.list(organizationId, { action, entityType });
  }

  @Get(':id')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.READ_ONLY)
  @ApiOperation({ summary: 'Get Detailed Audit Log with Diff (Tenant Enforced)' })
  async getById(
    @CurrentOrgId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.auditService.getById(organizationId, id);
  }
}
