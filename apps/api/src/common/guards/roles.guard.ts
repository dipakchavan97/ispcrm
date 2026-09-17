import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole, TenantContext } from '@isp-crm/shared';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user: TenantContext = request.user;

    if (!user || !user.role) {
      throw new ForbiddenException('User context missing or unassigned role');
    }

    // SuperAdmin has been decommissioned at application level.
    // Endpoints requiring SUPER_ADMIN cannot be accessed by any user.
    if (requiredRoles.length === 1 && requiredRoles[0] === UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('SuperAdmin endpoint is decommissioned');
    }

    // ISP_OWNER has full access across all tenant operations within their organization
    if (user.role === UserRole.ISP_OWNER) {
      return true;
    }

    // Role check: Ensure user's assigned tenant role is in the required roles list
    const hasRole = requiredRoles.includes(user.role);
    if (!hasRole) {
      throw new ForbiddenException(
        `Access denied: Required roles [${requiredRoles.join(', ')}], current role is ${user.role}`,
      );
    }

    return true;
  }
}
