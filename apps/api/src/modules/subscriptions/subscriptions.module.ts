import { Module } from '@nestjs/common';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionAutomationService } from './subscription-automation.service';
import { RadiusModule } from '../radius/radius.module';
import { InvoicesModule } from '../invoices/invoices.module';

@Module({
  imports: [RadiusModule, InvoicesModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, SubscriptionAutomationService],
  exports: [SubscriptionsService, SubscriptionAutomationService],
})
export class SubscriptionsModule {}
