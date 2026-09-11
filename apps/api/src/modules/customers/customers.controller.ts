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
import { CustomersService } from './customers.service';
import { CurrentOrgId } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole, CustomerStatus } from '@isp-crm/shared';

@ApiTags('Customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.SUPPORT, UserRole.TECHNICIAN, UserRole.READ_ONLY)
  @ApiOperation({ summary: 'List Subscribers Scoped to Current Tenant Organization with Pagination & Filters' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: CustomerStatus })
  @ApiQuery({ name: 'area', required: false, type: String })
  @ApiQuery({ name: 'city', required: false, type: String })
  async list(
    @CurrentOrgId() organizationId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('area') area?: string,
    @Query('city') city?: string,
  ) {
    return this.customersService.list(organizationId, {
      page,
      limit,
      search,
      status,
      area,
      city,
    });
  }

  @Post()
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.SUPPORT)
  @ApiOperation({ summary: 'Create New Customer & Provision PPPoE in RADIUS (Tenant Enforced, Audit Logged)' })
  async create(
    @CurrentOrgId() organizationId: string,
    @CurrentUser() user: any,
    @Body() body: any,
  ) {
    return this.customersService.create(organizationId, user?.userId, body);
  }

  @Get(':id')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.SUPPORT, UserRole.TECHNICIAN, UserRole.READ_ONLY)
  @ApiOperation({ summary: 'Get Detailed Customer Profile with History & Audit Trail (Tenant Enforced)' })
  async getById(@CurrentOrgId() organizationId: string, @Param('id') id: string) {
    return this.customersService.getById(organizationId, id);
  }

  @Patch(':id')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.SUPPORT)
  @ApiOperation({ summary: 'Edit Customer Information (Tenant Enforced, Audit Logged)' })
  async update(
    @CurrentOrgId() organizationId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.customersService.update(organizationId, user?.userId, id, body);
  }

  @Patch(':id/status')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.SUPPORT)
  @ApiOperation({ summary: 'Transition Customer Status (LEAD, PENDING, ACTIVE, SUSPENDED, EXPIRED, TERMINATED)' })
  async updateStatus(
    @CurrentOrgId() organizationId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body('status') status: CustomerStatus,
    @Body('notes') notes?: string,
  ) {
    return this.customersService.updateStatus(organizationId, user?.userId, id, status, notes);
  }

  @Post(':id/suspend')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN)
  @ApiOperation({ summary: 'Suspend Subscriber (Tenant Enforced, Audit Logged)' })
  async suspend(
    @CurrentOrgId() organizationId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.customersService.suspend(organizationId, user?.userId, id);
  }

  @Post(':id/reactivate')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN)
  @ApiOperation({ summary: 'Reactivate Suspended Subscriber (Tenant Enforced, Audit Logged)' })
  async reactivate(
    @CurrentOrgId() organizationId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.customersService.reactivate(organizationId, user?.userId, id);
  }

  @Post(':id/disconnect')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.TECHNICIAN)
  @ApiOperation({ summary: 'Force Disconnect Active PPPoE Session (Tenant Enforced)' })
  async disconnect(@CurrentOrgId() organizationId: string, @Param('id') id: string) {
    return this.customersService.disconnect(organizationId, id);
  }
}
