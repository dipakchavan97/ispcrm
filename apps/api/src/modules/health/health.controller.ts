import { Controller, Get, Res, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { HealthService } from './health.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'System Liveness & Readiness Probe' })
  @ApiResponse({ status: 200, description: 'System healthy or degraded' })
  async getHealth(@Res() res: Response) {
    const result = await this.healthService.checkOverall();
    return res.status(HttpStatus.OK).json(result);
  }

  @Get('db')
  @ApiOperation({ summary: 'PostgreSQL Database Health Probe' })
  async getDbHealth(@Res() res: Response) {
    const result = await this.healthService.checkDatabase();
    const status = result.status === 'up' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
    return res.status(status).json(result);
  }

  @Get('redis')
  @ApiOperation({ summary: 'Redis & BullMQ Health Probe' })
  async getRedisHealth(@Res() res: Response) {
    const result = await this.healthService.checkRedis();
    const status = result.status === 'up' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
    return res.status(status).json(result);
  }
}
