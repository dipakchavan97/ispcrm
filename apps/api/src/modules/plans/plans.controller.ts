import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { PlansService } from './plans.service';
import { CurrentOrgId } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole, PlanStatus } from '@isp-crm/shared';

@ApiTags('Internet Plans')
@ApiBearerAuth()
@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  @Roles(
    UserRole.ISP_OWNER,
    UserRole.ISP_ADMIN,
    UserRole.BILLING,
    UserRole.SUPPORT,
    UserRole.TECHNICIAN,
    UserRole.READ_ONLY,
  )
  @ApiOperation({ summary: 'List Available Internet Plans for Current Tenant' })
  @ApiQuery({ name: 'status', required: false, enum: PlanStatus })
  @ApiQuery({ name: 'search', required: false, type: String })
  async list(
    @CurrentOrgId() organizationId: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.plansService.list(organizationId, { status, search });
  }

  @Post()
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING)
  @ApiOperation({ summary: 'Create New Internet Plan (Tenant Enforced)' })
  async create(
    @CurrentOrgId() organizationId: string,
    @CurrentUser() user: any,
    @Body() body: any,
  ) {
    return this.plansService.create(organizationId, user?.userId, body);
  }

  @Get('bandwidth-policies')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.TECHNICIAN)
  @ApiOperation({ summary: 'List Bandwidth Policies' })
  async listPolicies(@CurrentOrgId() organizationId: string) {
    return this.plansService.listPolicies(organizationId);
  }

  @Post('simulate-policy')
  @Roles(
    UserRole.ISP_OWNER,
    UserRole.ISP_ADMIN,
    UserRole.BILLING,
    UserRole.SUPPORT,
    UserRole.TECHNICIAN,
    UserRole.READ_ONLY,
  )
  @ApiOperation({ summary: 'Simulate 3-Tier Network Policy (Plan -> NetworkPolicy -> RadiusAttributes)' })
  async simulatePolicy(@Body() body: any) {
    return this.plansService.simulatePolicy(body);
  }

  @Get(':id')
  @Roles(
    UserRole.ISP_OWNER,
    UserRole.ISP_ADMIN,
    UserRole.BILLING,
    UserRole.SUPPORT,
    UserRole.TECHNICIAN,
    UserRole.READ_ONLY,
  )
  @ApiOperation({ summary: 'Get Internet Plan By ID (Tenant Enforced)' })
  async getById(
    @CurrentOrgId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.plansService.getById(organizationId, id);
  }

  @Patch(':id')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING)
  @ApiOperation({ summary: 'Update Internet Plan (Tenant Enforced)' })
  async update(
    @CurrentOrgId() organizationId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.plansService.update(organizationId, user?.userId, id, body);
  }

  @Patch(':id/status')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING)
  @ApiOperation({ summary: 'Update Plan Status (Activate/Deactivate)' })
  async updateStatus(
    @CurrentOrgId() organizationId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body('status') status: PlanStatus,
  ) {
    return this.plansService.toggleStatus(organizationId, user?.userId, id, status);
  }

  @Post(':id/toggle')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING)
  @ApiOperation({ summary: 'Toggle Plan Active Status' })
  async toggle(
    @CurrentOrgId() organizationId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.plansService.toggleStatus(organizationId, user?.userId, id);
  }
}

