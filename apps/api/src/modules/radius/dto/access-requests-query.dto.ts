import { IsOptional, IsString, IsInt, Min, Max, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum AccessRequestStatusFilter {
  ALL = 'ALL',
  ACCEPT = 'ACCEPT',
  REJECT = 'REJECT',
}

export class AccessRequestsQueryDto {
  @ApiPropertyOptional({ description: 'Page number for pagination', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Page size limit', default: 25, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;

  @ApiPropertyOptional({ description: 'Filter by subscriber username (partial or exact)' })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional({ description: 'Filter by subscriber MAC address / calling station' })
  @IsOptional()
  @IsString()
  mac?: string;

  @ApiPropertyOptional({
    description: 'Filter by authentication outcome',
    enum: AccessRequestStatusFilter,
    default: AccessRequestStatusFilter.ALL,
  })
  @IsOptional()
  @IsEnum(AccessRequestStatusFilter)
  status?: AccessRequestStatusFilter = AccessRequestStatusFilter.ALL;

  @ApiPropertyOptional({ description: 'Raw RADIUS packet reply type (e.g. Access-Accept, Access-Reject)' })
  @IsOptional()
  @IsString()
  reply?: string;

  @ApiPropertyOptional({ description: 'Filter requests from this ISO timestamp' })
  @IsOptional()
  @IsString()
  fromDate?: string;

  @ApiPropertyOptional({ description: 'Filter requests up to this ISO timestamp' })
  @IsOptional()
  @IsString()
  toDate?: string;
}
