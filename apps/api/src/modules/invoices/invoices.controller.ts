import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InvoicesService } from './invoices.service';
import { CurrentOrgId } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@isp-crm/shared';

@ApiTags('Invoices')
@ApiBearerAuth()
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get('metrics')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING, UserRole.READ_ONLY)
  @ApiOperation({ summary: 'Get Billing KPI Metrics (Tenant Enforced)' })
  async getMetrics(@CurrentOrgId() organizationId: string) {
    return this.invoicesService.getMetrics(organizationId);
  }

  @Get()
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING, UserRole.READ_ONLY)
  @ApiOperation({ summary: 'List GST Invoices (Tenant Enforced)' })
  async list(
    @CurrentOrgId() organizationId: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('customerId') customerId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.invoicesService.list(organizationId, {
      status,
      search,
      customerId,
      startDate,
      endDate,
      page,
      limit,
    });
  }

  @Post('preview')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING)
  @ApiOperation({ summary: 'Live calculate invoice subtotal, taxes, and grand total' })
  async preview(@CurrentOrgId() organizationId: string, @Body() body: any) {
    return this.invoicesService.preview(organizationId, body);
  }

  @Post()
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING)
  @ApiOperation({ summary: 'Create Ad-Hoc / Periodic Invoice (Tenant Enforced)' })
  async create(
    @CurrentOrgId() organizationId: string,
    @CurrentUser('userId') adminUserId: string | undefined,
    @Body() body: any,
  ) {
    return this.invoicesService.create(organizationId, adminUserId, body);
  }

  @Post('generate-cycle')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING)
  @ApiOperation({ summary: 'Trigger Batch Monthly Invoice Generation' })
  async generateCycle(@CurrentOrgId() organizationId: string) {
    return this.invoicesService.generateCycle(organizationId);
  }

  @Get(':id')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING, UserRole.READ_ONLY)
  @ApiOperation({ summary: 'Get Invoice Details & Line Items (Tenant Enforced)' })
  async getById(@CurrentOrgId() organizationId: string, @Param('id') id: string) {
    return this.invoicesService.getById(organizationId, id);
  }

  @Get(':id/pdf')
  @Roles(
    UserRole.ISP_OWNER,
    UserRole.ISP_ADMIN,
    UserRole.BILLING,
    UserRole.SUPPORT,
    UserRole.READ_ONLY,
  )
  @ApiOperation({ summary: 'Download or Preview Server-Generated GST Tax Invoice PDF (Tenant Enforced)' })
  async downloadPdf(
    @CurrentOrgId() organizationId: string,
    @Param('id') id: string,
    @Res() res: Response,
    @Query('preview') preview?: string,
  ) {
    const { buffer, filename } = await this.invoicesService.generatePdf(organizationId, id);

    res.setHeader('Content-Type', 'application/pdf');
    const isPreview = preview === 'true' || preview === '1';
    const dispositionType = isPreview ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${dispositionType}; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  @Post(':id/cancel')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING)
  @ApiOperation({ summary: 'Cancel Invoice (Tenant Enforced)' })
  async cancel(
    @CurrentOrgId() organizationId: string,
    @CurrentUser('userId') adminUserId: string | undefined,
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.invoicesService.cancel(organizationId, adminUserId, id, reason);
  }
}
