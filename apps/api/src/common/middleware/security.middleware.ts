import { Injectable, NestMiddleware, BadRequestException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

function checkAndSanitize(obj: any): void {
  if (!obj || typeof obj !== 'object') {
    return;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    for (const item of obj) {
      checkAndSanitize(item);
    }
    return;
  }

  // Check if prototype was hijacked via __proto__
  const proto = Object.getPrototypeOf(obj);
  if (proto !== null && proto !== Object.prototype) {
    throw new BadRequestException('Security violation: prototype pollution attempt detected');
  }

  // Check object keys
  for (const key of Object.keys(obj)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new BadRequestException('Security violation: prototype pollution attempt detected');
    }
    checkAndSanitize(obj[key]);
  }
}

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // 1. Defend against Prototype Pollution in body, query, and params
    if (req.body) {
      checkAndSanitize(req.body);
    }
    if (req.query) {
      checkAndSanitize(req.query);
    }

    // 2. Set OWASP Recommended Defensive HTTP Security Headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    next();
  }
}
