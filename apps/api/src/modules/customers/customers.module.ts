import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CafPdfService } from './caf-pdf.service';
import { RadiusModule } from '../radius/radius.module';

@Module({
  imports: [RadiusModule],
  controllers: [CustomersController],
  providers: [CustomersService, CafPdfService],
  exports: [CustomersService, CafPdfService],
})
export class CustomersModule {}
