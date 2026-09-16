import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import { CafPdfService } from './caf-pdf.service';
import { CurrentOrgId } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole, CustomerStatus } from '@isp-crm/shared';

@ApiTags('Customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly cafPdfService: CafPdfService,
  ) {}

  @Get()
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.SUPPORT, UserRole.TECHNICIAN, UserRole.READ_ONLY)
  @ApiOperation({ summary: 'List Subscribers Scoped to Current Tenant Organization with Pagination & Filters' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: CustomerStatus })
  @ApiQuery({ name: 'area', required: false, type: String })
  @ApiQuery({ name: 'city', required: false, type: String })
  @ApiQuery({ name: 'zoneId', required: false, type: String })
  @ApiQuery({ name: 'nodeId', required: false, type: String })
  async list(
    @CurrentOrgId() organizationId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('area') area?: string,
    @Query('city') city?: string,
    @Query('zoneId') zoneId?: string,
    @Query('nodeId') nodeId?: string,
  ) {
    return this.customersService.list(organizationId, {
      page,
      limit,
      search,
      status,
      area,
      city,
      zoneId,
      nodeId,
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

  @Post(':id/reset-mac')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.SUPPORT)
  @ApiOperation({ summary: 'Reset Authorized MAC to Auto-Learn Next PPPoE Device (Tenant Enforced, Audit Logged)' })
  async resetMac(
    @CurrentOrgId() organizationId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.customersService.resetMac(organizationId, user?.userId, id);
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

  @Get(':id/connection')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.SUPPORT, UserRole.TECHNICIAN, UserRole.READ_ONLY)
  @ApiOperation({ summary: 'Real-Time Connection Telemetry & Session Info (Tenant Enforced)' })
  async getConnection(@CurrentOrgId() organizationId: string, @Param('id') id: string) {
    return this.customersService.getConnection(organizationId, id);
  }

  @Get(':id/usage')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.SUPPORT, UserRole.TECHNICIAN, UserRole.READ_ONLY)
  @ApiOperation({ summary: 'Aggregated RADIUS Data Usage (Today, Monthly, Lifetime) (Tenant Enforced)' })
  async getUsage(@CurrentOrgId() organizationId: string, @Param('id') id: string) {
    return this.customersService.getUsage(organizationId, id);
  }

  @Get(':id/access-requests')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.SUPPORT, UserRole.TECHNICIAN, UserRole.READ_ONLY)
  @ApiOperation({ summary: 'Latest RADIUS Authentication Attempts from radpostauth (Tenant Enforced)' })
  async getAccessRequests(@CurrentOrgId() organizationId: string, @Param('id') id: string) {
    return this.customersService.getAccessRequests(organizationId, id);
  }

  @Post(':id/override-speed')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.TECHNICIAN)
  @ApiOperation({ summary: 'Override Subscriber Bandwidth Rate Limit (Tenant Enforced, Audit Logged)' })
  async overrideSpeed(
    @CurrentOrgId() organizationId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body('downloadMbps') downloadMbps: number,
    @Body('uploadMbps') uploadMbps: number,
  ) {
    return this.customersService.overrideSpeed(organizationId, user?.userId, id, downloadMbps, uploadMbps);
  }

  @Get(':id/caf.pdf')
  @Roles(
    UserRole.ISP_OWNER,
    UserRole.ISP_ADMIN,
    UserRole.SUPPORT,
    UserRole.TECHNICIAN,
    UserRole.READ_ONLY,
  )
  @ApiOperation({ summary: 'Download or Preview statutory Customer Application Form (CAF) PDF (Tenant Enforced)' })
  async downloadCafPdf(
    @CurrentOrgId() organizationId: string,
    @Param('id') id: string,
    @Res() res: Response,
    @Query('preview') preview?: string,
  ) {
    const { buffer, filename } = await this.cafPdfService.generateCafPdf(organizationId, id);

    res.setHeader('Content-Type', 'application/pdf');
    const isPreview = preview === 'true' || preview === '1';
    const dispositionType = isPreview ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${dispositionType}; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }
}
