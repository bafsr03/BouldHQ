import Bowser from 'bowser';
import { getTokenFromRequest } from "@server/lib/helper";
import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';

declare module 'express' {
  interface Request {
    user?: any;
    isAuthenticated?: () => boolean;
    login?: (user: any, callback?: (err: any) => void) => void;
    logout?: (callback?: (err: any) => void) => void;
  }
}

export interface User extends jwt.JwtPayload {
  name: string;
  sub: string;
  role: string;
  id: string;
  exp: number;
  iat: number;
  ip?: string;
  userAgent?: any;
  permissions?: string[];
  twoFactorVerified?: boolean;
  origin?: string;
}

export async function createContext(req: Request, res: Response) {
  const headers = req?.headers || {};
  const ua = headers['user-agent'] || '';
  const userAgent = ua ? Bowser.parse(ua) : null;

  // Origin the request actually came in on — used by mutations that need to
  // generate links pointing back to the same host (magic links, etc).
  // req.protocol + req.get('host') honors Express's trust-proxy setting, so
  // behind a reverse proxy this becomes the public-facing https://host:port.
  const origin = (() => {
    try {
      const host = req?.get?.('host');
      const proto = req?.protocol || 'http';
      return host ? `${proto}://${host}` : '';
    } catch {
      return '';
    }
  })();

  try {
    const token = await getTokenFromRequest(req as any) as User;
    if (token?.sub) {
      return { ...token, id: token.sub, ip: req?.ip || '0.0.0.0', userAgent, origin } as User;
    }
  } catch (error) {
    console.error('get token error:', error);
  }

  return { userAgent, origin } as User;
}

export type Context = Awaited<ReturnType<typeof createContext>>;