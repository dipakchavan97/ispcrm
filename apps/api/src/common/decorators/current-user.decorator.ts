import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { TenantContext } from '@isp-crm/shared';

export const CurrentUser = createParamDecorator(
  (data: keyof TenantContext | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user: TenantContext = request.user;
    if (!user) {
      return null;
    }
    return data ? user[data] : user;
  },
);
