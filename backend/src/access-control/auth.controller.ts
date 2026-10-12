import { Body, Controller, Get, Post, Req, Res, UsePipes, ValidationPipe } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './access.dto';
import { readCookie } from './access.guard';
import { SESSION_COOKIE, SESSION_TTL_MS } from './access.constants';

@Controller('syncdrive-api/auth')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  async login(@Body() body: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(body.account_name, body.password, this.client(req));
    res.cookie(SESSION_COOKIE, result.token, {
      httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_TTL_MS, path: '/',
    });
    return { user: result.user, csrf_token: result.csrf };
  }

  @Get('me')
  async me(@Req() req: Request) {
    const result = await this.auth.me(readCookie(req));
    return result ? { authenticated: true, user: result.user, csrf_token: result.csrf } : { authenticated: false, user: null };
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(readCookie(req), this.client(req));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { logged_out: true };
  }

  private client(req: Request) {
    return { ip: req.ip, userAgent: req.header('user-agent') ?? undefined };
  }
}
