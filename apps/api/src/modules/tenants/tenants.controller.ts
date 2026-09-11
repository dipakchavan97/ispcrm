import { Controller, Get, Patch, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TenantsService } from './tenants.service';
import { CurrentOrgId } from '../../common/decorators/current-org.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@isp-crm/shared';

@ApiTags('Organizations')
@ApiBearerAuth()
@Controller('organizations')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get('current')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING, UserRole.SUPPORT, UserRole.TECHNICIAN, UserRole.READ_ONLY)
  @ApiOperation({ summary: 'Get Current Tenant Organization Profile' })
  async getCurrent(@CurrentOrgId() organizationId: string) {
    return this.tenantsService.getById(organizationId);
  }

  @Patch('current')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN)
  @ApiOperation({ summary: 'Update Current Tenant Organization Profile' })
  async update(@CurrentOrgId() organizationId: string, @Body() body: any) {
    return this.tenantsService.update(organizationId, body);
  }
}
