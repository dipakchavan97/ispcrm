import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import jwt from 'jsonwebtoken';
import { prisma } from '@isp-crm/database';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JwtPayload, TenantContext, UserRole } from '@isp-crm/shared';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const token = authHeader.split(' ')[1];
    const secret = process.env.JWT_SECRET || 'super-secret-jwt-key-change-in-production';

    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, secret) as JwtPayload;
    } catch {
      throw new UnauthorizedException('Token is invalid or expired');
    }

    // Verify user exists and is active in database
    const user = await prisma.adminUser.findUnique({
      where: { id: payload.sub },
      include: { organization: true },
    });

    if (!user || !user.isActive || !user.organization.isActive) {
      throw new UnauthorizedException('User account or organization is inactive');
    }

    // Securely attach TenantContext to request
    const tenantContext: TenantContext = {
      userId: user.id,
      organizationId: user.organizationId,
      email: user.email,
      role: user.role as unknown as UserRole,
      name: user.name,
      orgSlug: user.organization.slug,
    };

    request.user = tenantContext;
    return true;
  }
}
