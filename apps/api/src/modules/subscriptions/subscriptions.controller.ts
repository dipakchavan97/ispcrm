import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SubscriptionsService } from './subscriptions.service';
import { CurrentOrgId } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole, SubscriptionStatus } from '@isp-crm/shared';

@ApiTags('Subscriptions')
@ApiBearerAuth()
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get()
  @Roles(
    UserRole.ISP_OWNER,
    UserRole.ISP_ADMIN,
    UserRole.BILLING,
    UserRole.SUPPORT,
    UserRole.READ_ONLY,
  )
  @ApiOperation({ summary: 'List Customer Subscriptions (Tenant Enforced)' })
  @ApiQuery({ name: 'status', required: false, enum: SubscriptionStatus })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'customerId', required: false, type: String })
  async list(
    @CurrentOrgId() organizationId: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('customerId') customerId?: string,
  ) {
    return this.subscriptionsService.list(organizationId, {
      status,
      search,
      customerId,
    });
  }

  @Post()
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING)
  @ApiOperation({ summary: 'Create New Subscription (Tenant Enforced)' })
  async create(
    @CurrentOrgId() organizationId: string,
    @CurrentUser() user: any,
    @Body() body: any,
  ) {
    return this.subscriptionsService.create(organizationId, user?.userId, body);
  }

  @Get(':id')
  @Roles(
    UserRole.ISP_OWNER,
    UserRole.ISP_ADMIN,
    UserRole.BILLING,
    UserRole.SUPPORT,
    UserRole.READ_ONLY,
  )
  @ApiOperation({ summary: 'Get Subscription Details & Timeline (Tenant Enforced)' })
  async getById(
    @CurrentOrgId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.subscriptionsService.getById(organizationId, id);
  }

  @Get(':id/history')
  @Roles(
    UserRole.ISP_OWNER,
    UserRole.ISP_ADMIN,
    UserRole.BILLING,
    UserRole.SUPPORT,
    UserRole.READ_ONLY,
  )
  @ApiOperation({ summary: 'Get Subscription History Timeline' })
  async getHistory(
    @CurrentOrgId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.subscriptionsService.getHistory(organizationId, id);
  }

  @Post(':id/activate')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING)
  @ApiOperation({ summary: 'Activate PENDING Subscription' })
  async activate(
    @CurrentOrgId() organizationId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.subscriptionsService.activate(organizationId, user?.userId, id);
  }

  @Post(':id/renew')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING)
  @ApiOperation({ summary: 'Renew Subscription Validity' })
  async renew(
    @CurrentOrgId() organizationId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body?: any,
  ) {
    return this.subscriptionsService.renew(organizationId, user?.userId, id, body);
  }

  @Post(':id/upgrade')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING)
  @ApiOperation({ summary: 'Upgrade Subscription Plan' })
  async upgrade(
    @CurrentOrgId() organizationId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body('planId') planId: string,
    @Body('reason') reason?: string,
  ) {
    return this.subscriptionsService.upgrade(organizationId, user?.userId, id, planId, reason);
  }

  @Post(':id/downgrade')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING)
  @ApiOperation({ summary: 'Downgrade Subscription Plan' })
  async downgrade(
    @CurrentOrgId() organizationId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body('planId') planId: string,
    @Body('reason') reason?: string,
  ) {
    return this.subscriptionsService.downgrade(organizationId, user?.userId, id, planId, reason);
  }

  @Post(':id/change-plan')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING)
  @ApiOperation({ summary: 'Change Plan (Upgrade/Downgrade alias)' })
  async changePlan(
    @CurrentOrgId() organizationId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body('planId') planId: string,
    @Body('reason') reason?: string,
  ) {
    return this.subscriptionsService.upgrade(organizationId, user?.userId, id, planId, reason);
  }

  @Post(':id/suspend')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING, UserRole.SUPPORT)
  @ApiOperation({ summary: 'Suspend Subscription' })
  async suspend(
    @CurrentOrgId() organizationId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.subscriptionsService.suspend(organizationId, user?.userId, id, reason);
  }

  @Post(':id/reactivate')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING, UserRole.SUPPORT)
  @ApiOperation({ summary: 'Reactivate Suspended Subscription' })
  async reactivate(
    @CurrentOrgId() organizationId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.subscriptionsService.reactivate(organizationId, user?.userId, id);
  }

  @Post(':id/expire')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING)
  @ApiOperation({ summary: 'Expire Subscription' })
  async expire(
    @CurrentOrgId() organizationId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.subscriptionsService.expire(organizationId, user?.userId, id, reason);
  }

  @Post(':id/cancel')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN)
  @ApiOperation({ summary: 'Cancel Subscription (Terminal State)' })
  async cancel(
    @CurrentOrgId() organizationId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.subscriptionsService.cancel(organizationId, user?.userId, id, reason);
  }
}
