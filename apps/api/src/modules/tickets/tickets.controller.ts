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
import { TicketsService } from './tickets.service';
import { CurrentOrgId } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@isp-crm/shared';

@ApiTags('Tickets')
@ApiBearerAuth()
@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get()
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.SUPPORT, UserRole.TECHNICIAN, UserRole.READ_ONLY)
  @ApiOperation({ summary: 'List Helpdesk Tickets (Tenant Enforced)' })
  @ApiQuery({ name: 'customerId', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'priority', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  async list(
    @CurrentOrgId() organizationId: string,
    @Query('customerId') customerId?: string,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('search') search?: string,
  ) {
    return this.ticketsService.list(organizationId, {
      customerId,
      status,
      priority,
      search,
    });
  }

  @Get('stats/summary')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.SUPPORT, UserRole.TECHNICIAN, UserRole.READ_ONLY)
  @ApiOperation({ summary: 'Get Ticket Statistics for Dashboard' })
  async getStats(@CurrentOrgId() organizationId: string) {
    return this.ticketsService.getStats(organizationId);
  }

  @Get(':id')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.SUPPORT, UserRole.TECHNICIAN, UserRole.READ_ONLY)
  @ApiOperation({ summary: 'Get Ticket Details with Comments (Tenant Enforced)' })
  async getById(
    @CurrentOrgId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.ticketsService.getById(organizationId, id);
  }

  @Post()
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.SUPPORT, UserRole.TECHNICIAN)
  @ApiOperation({ summary: 'Create a Helpdesk Ticket (Tenant Enforced)' })
  async create(
    @CurrentOrgId() organizationId: string,
    @CurrentUser() user: any,
    @Body() body: any,
  ) {
    return this.ticketsService.create(organizationId, user?.userId, body);
  }

  @Patch(':id')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.SUPPORT, UserRole.TECHNICIAN)
  @ApiOperation({ summary: 'Update Ticket Status/Priority/Assignment (Tenant Enforced)' })
  async update(
    @CurrentOrgId() organizationId: string,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.ticketsService.update(organizationId, id, body);
  }

  @Post(':id/comments')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.SUPPORT, UserRole.TECHNICIAN)
  @ApiOperation({ summary: 'Add a Comment to a Ticket' })
  async addComment(
    @CurrentOrgId() organizationId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    const authorName = user?.name || user?.email || 'Support Staff';
    return this.ticketsService.addComment(organizationId, id, authorName, body);
  }
}
