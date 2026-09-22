import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
// Bounded in-process limits suit this single-server MVP. Do not trust X-Forwarded-For.
@Injectable()
export class BoundaryMiddleware implements NestMiddleware {
  private buckets = new Map<string, { count: number; until: number }>();
  use(req: Request, res: Response, next: NextFunction) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = process.env.APP_ORIGIN || 'http://localhost:3010';
      if (req.headers.origin !== origin || !req.is('application/json'))
        return res
          .status(403)
          .json({ message: 'Request origin or content type is not allowed' });
    }
    const now = Date.now();
    for (const [key, value] of this.buckets)
      if (value.until < now) this.buckets.delete(key);
    const login = req.path === '/auth/login';
    const resetRequest = req.path === '/auth/password/request';
    if (req.method === 'POST') {
      let bucket = 'write';
      let limit = 240;
      if (resetRequest) {
        bucket = 'reset';
        limit = 60;
      } else if (login) {
        bucket = 'login';
        limit = 15;
      }
      const key = `${req.socket.remoteAddress}:${bucket}`;
      let b = this.buckets.get(key);
      if (!b) {
        b = { count: 0, until: now + 60000 };
        this.buckets.set(key, b);
      }
      if (++b.count > limit) {
        res.setHeader('Retry-After', '60');
        return res
          .status(429)
          .json({ message: 'Too many requests. Please wait a minute.' });
      }
    }
    next();
  }
}
