import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { CurrentOrgId } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@isp-crm/shared';

@ApiTags('Payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING, UserRole.READ_ONLY)
  @ApiOperation({ summary: 'List Recorded Payments (Tenant Enforced)' })
  async list(
    @CurrentOrgId() organizationId: string,
    @Query('status') status?: string,
    @Query('paymentMethod') paymentMethod?: string,
    @Query('customerId') customerId?: string,
    @Query('invoiceId') invoiceId?: string,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.paymentsService.list(organizationId, {
      status,
      paymentMethod,
      customerId,
      invoiceId,
      search,
      page,
      limit,
    });
  }

  @Post()
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING)
  @ApiOperation({ summary: 'Record Manual Payment (Cash/Transfer/Cheque)' })
  async recordPayment(
    @CurrentOrgId() organizationId: string,
    @CurrentUser('userId') adminUserId: string | undefined,
    @Body() body: any,
  ) {
    return this.paymentsService.recordPayment(organizationId, adminUserId, body);
  }

  @Post('create-intent')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING, UserRole.SUPPORT)
  @ApiOperation({ summary: 'Initiate Online Gateway Order Intent' })
  async createIntent(@CurrentOrgId() organizationId: string, @Body() body: any) {
    return this.paymentsService.createPaymentIntent(organizationId, body);
  }

  @Post('verify')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING, UserRole.SUPPORT)
  @ApiOperation({ summary: 'Idempotent Online Payment Verification & Tri-State Settlement' })
  async verifyPayment(
    @CurrentOrgId() organizationId: string,
    @CurrentUser('userId') adminUserId: string | undefined,
    @Body() body: any,
  ) {
    return this.paymentsService.verifyAndSettleOnlinePayment(organizationId, adminUserId, body);
  }

  @Post(':id/refund')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING)
  @ApiOperation({ summary: 'Process Gateway or Ledger Refund' })
  async refund(
    @CurrentOrgId() organizationId: string,
    @CurrentUser('userId') adminUserId: string | undefined,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.paymentsService.refundPayment(organizationId, adminUserId, id, body || {});
  }

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 60, ttlSec: 60, keyPrefix: 'payment_webhook' })
  @ApiOperation({ summary: 'Asynchronous Payment Gateway Webhook Receiver (Signature-Verified & Idempotent)' })
  async handleWebhook(
    @Headers('x-webhook-signature') headerSignature: string | undefined,
    @Body() body: any,
  ) {
    return this.paymentsService.handleWebhook(body, headerSignature);
  }

  @Get(':id')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING, UserRole.READ_ONLY)
  @ApiOperation({ summary: 'Get Payment Details (Tenant Enforced)' })
  async getById(@CurrentOrgId() organizationId: string, @Param('id') id: string) {
    return this.paymentsService.getById(organizationId, id);
  }
}
