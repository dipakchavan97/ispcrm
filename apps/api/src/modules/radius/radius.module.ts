import { Module } from '@nestjs/common';
import { RadiusController } from './radius.controller';
import { RadiusService } from './radius.service';
import { RadiusCoaQueueService } from './radius-coa-queue.service';

@Module({
  controllers: [RadiusController],
  providers: [RadiusService, RadiusCoaQueueService],
  exports: [RadiusService, RadiusCoaQueueService],
})
export class RadiusModule {}
