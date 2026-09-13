import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '@isp-crm/database';
import {
  UserRole,
  LoginInput,
  RegisterOrganizationInput,
  RefreshTokenInput,
  JwtPayload,
  AuthTokensResponse,
} from '@isp-crm/shared';

@Injectable()
export class AuthService {
  private readonly jwtSecret =
    process.env.JWT_SECRET || 'super-secret-jwt-key-change-in-production';
  private readonly accessTokenExpiry = '1h';
  private readonly refreshTokenExpiry = '7d';

  /**
   * Register a new ISP Organization and its primary ISP_OWNER admin user
   */
  async registerOrganization(dto: RegisterOrganizationInput): Promise<AuthTokensResponse> {
    // 1. Check if organization slug or owner email already exists
    const existingOrg = await prisma.organization.findUnique({
      where: { slug: dto.slug },
    });
    if (existingOrg) {
      throw new ConflictException(`Organization slug '${dto.slug}' is already taken`);
    }

    const existingUser = await prisma.adminUser.findFirst({
      where: { email: dto.ownerEmail },
    });
    if (existingUser) {
      throw new ConflictException(`User email '${dto.ownerEmail}' is already registered`);
    }

    // 2. Hash password
    const passwordHash = await bcrypt.hash(dto.ownerPassword, 10);

    // 3. Atomically create organization and ISP_OWNER user
    const { org, user } = await prisma.$transaction(async (tx) => {
      const createdOrg = await tx.organization.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          legalName: dto.legalName,
          gstin: dto.gstin,
          email: dto.email,
          phone: dto.phone,
          address: dto.address,
          city: dto.city,
          state: dto.state,
          stateCode: dto.stateCode,
          pincode: dto.pincode,
          currency: 'INR',
          timezone: 'Asia/Kolkata',
        },
      });

      const createdUser = await tx.adminUser.create({
        data: {
          organizationId: createdOrg.id,
          name: dto.ownerName,
          email: dto.ownerEmail,
          passwordHash,
          phone: dto.ownerPhone,
          role: UserRole.ISP_OWNER,
        },
      });

      return { org: createdOrg, user: createdUser };
    });

    // 4. Generate token pair
    return this.generateTokensForUser(user, org.name, org.slug);
  }

  /**
   * Authenticate admin user via email and password
   */
  async login(dto: LoginInput): Promise<AuthTokensResponse> {
    const user = await prisma.adminUser.findFirst({
      where: { email: dto.email },
      include: { organization: true },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive || !user.organization.isActive) {
      throw new UnauthorizedException('Account or organization is inactive');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokens = await this.generateTokensForUser(user, user.organization.name, user.organization.slug);

    // Security Audit Log: Record successful authentication
    await prisma.auditLog
      .create({
        data: {
          organizationId: user.organizationId,
          adminUserId: user.id,
          action: 'LOGIN' as any,
          entityType: 'ADMIN_USER',
          entityId: user.id,
          details: {
            email: user.email,
            role: user.role,
          },
        },
      })
      .catch(() => {});

    return tokens;
  }

  /**
   * Rotate and refresh access token using valid refresh token
   */
  async refreshToken(dto: RefreshTokenInput): Promise<AuthTokensResponse> {
    let payload: JwtPayload;
    try {
      payload = jwt.verify(dto.refreshToken, this.jwtSecret) as JwtPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await prisma.adminUser.findUnique({
      where: { id: payload.sub },
      include: { organization: true },
    });

    if (!user || !user.isActive || !user.refreshTokenHash) {
      throw new UnauthorizedException('Session expired or user inactive');
    }

    const isMatch = await bcrypt.compare(dto.refreshToken, user.refreshTokenHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.generateTokensForUser(user, user.organization.name, user.organization.slug);
  }

  /**
   * Invalidate active refresh token for user and record audit log
   */
  async logout(userId: string): Promise<{ message: string }> {
    const user = await prisma.adminUser.findUnique({ where: { id: userId } });
    await prisma.adminUser.update({
      where: { id: userId },
      data: { refreshTokenHash: null },
    });

    if (user) {
      await prisma.auditLog
        .create({
          data: {
            organizationId: user.organizationId,
            adminUserId: user.id,
            action: 'LOGOUT' as any,
            entityType: 'ADMIN_USER',
            entityId: user.id,
            details: { email: user.email },
          },
        })
        .catch(() => {});
    }

    return { message: 'Logged out successfully' };
  }

  /**
   * Fetch sanitized authenticated user profile
   */
  async getCurrentUser(userId: string) {
    const user = await prisma.adminUser.findUnique({
      where: { id: userId },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            email: true,
            phone: true,
            gstin: true,
            state: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      lastLoginAt: user.lastLoginAt,
      organization: user.organization,
    };
  }

  /**
   * Helper to sign JWT access and refresh tokens and persist refresh hash
   */
  private async generateTokensForUser(
    user: { id: string; email: string; role: any; organizationId: string; name: string },
    organizationName: string,
    orgSlug: string,
  ): Promise<AuthTokensResponse> {
    const role = user.role as UserRole;
    const payload: JwtPayload = {
      sub: user.id,
      organizationId: user.organizationId,
      email: user.email,
      role,
      orgSlug,
    };

    const accessToken = jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.accessTokenExpiry,
    });

    const refreshToken = jwt.sign({ sub: user.id }, this.jwtSecret, {
      expiresIn: this.refreshTokenExpiry,
    });

    // Hash refresh token before saving in database
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await prisma.adminUser.update({
      where: { id: user.id },
      data: {
        refreshTokenHash,
        lastLoginAt: new Date(),
      },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role,
        organizationId: user.organizationId,
        organizationName,
      },
    };
  }
}
