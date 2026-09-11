import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { TenantContext } from '@isp-crm/shared';

export const CurrentOrgId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const user: TenantContext = request.user;
    if (!user || !user.organizationId) {
      throw new UnauthorizedException('Tenant context missing from authenticated session');
    }
    return user.organizationId;
  },
);
