import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  LoginInput,
  RegisterOrganizationInput,
  RefreshTokenInput,
} from '@isp-crm/shared';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @RateLimit({ limit: 15, ttlSec: 3600, keyPrefix: 'register_org' })
  @Post('register-org')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register New ISP Organization & Initial ISP_OWNER' })
  async registerOrganization(@Body() body: RegisterOrganizationInput) {
    return this.authService.registerOrganization(body);
  }

  @Public()
  @RateLimit({ limit: 30, ttlSec: 60, keyPrefix: 'login' })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin User Login' })
  async login(@Body() body: LoginInput) {
    return this.authService.login(body);
  }

  @Public()
  @RateLimit({ limit: 60, ttlSec: 60, keyPrefix: 'refresh' })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh Access Token using Valid Refresh Token' })
  async refresh(@Body() body: RefreshTokenInput) {
    return this.authService.refreshToken(body);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke Active Refresh Token' })
  async logout(@CurrentUser('userId') userId: string) {
    return this.authService.logout(userId);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get Current Authenticated User Profile' })
  async me(@CurrentUser('userId') userId: string) {
    return this.authService.getCurrentUser(userId);
  }
}
