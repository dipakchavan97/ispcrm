import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CurrentOrgId } from '../../common/decorators/current-org.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole, CreateAdminUserInput } from '@isp-crm/shared';

@ApiTags('Admin Users & RBAC')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN)
  @ApiOperation({ summary: 'List Admin Users Scoped to Current Tenant Organization' })
  async list(@CurrentOrgId() organizationId: string) {
    return this.usersService.list(organizationId);
  }

  @Post()
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN)
  @ApiOperation({ summary: 'Create New Staff Admin User with Assigned Role' })
  async create(
    @CurrentOrgId() organizationId: string,
    @Body() body: CreateAdminUserInput,
  ) {
    return this.usersService.create(organizationId, body);
  }

  @Get(':id')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN)
  @ApiOperation({ summary: 'Get Admin User Profile (Tenant Enforced)' })
  async getById(
    @CurrentOrgId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.usersService.getById(organizationId, id);
  }

  @Patch(':id')
  @Roles(UserRole.ISP_OWNER, UserRole.ISP_ADMIN)
  @ApiOperation({ summary: 'Update Staff Admin User Status or Role' })
  async update(
    @CurrentOrgId() organizationId: string,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.usersService.update(organizationId, id, body);
  }
}
