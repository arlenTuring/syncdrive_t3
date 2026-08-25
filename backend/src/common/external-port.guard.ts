import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { EXTERNAL_API_METADATA_KEY } from './external-api.decorator';

/**
 * 對外 port 的路由圍籬。
 *
 * 同一個應用程式同時聽兩個 port：內部 port 給我方前端與後台，對外 port 給協力廠商。
 * 兩個 port 走的是同一份路由表，所以<strong>光靠文件分兩份是不夠的</strong>——文件
 * 只是不列出來，路徑本身仍然打得通，對方拿到 base URL 就能自己猜。
 *
 * 這一支負責讓「網路上打得到的」等於「文件上看得到的」：從對外 port 進來的請求，
 * 只有掛了 {@link ExternalApi} 的路由會被放行，其餘一律 404——回 404 而不是 403，
 * 是為了不洩漏「這條路徑存在」這件事。
 *
 * 反向不擋：內部 port 什麼都能打，包含對外那幾支，我方前端本來就會用到它們。
 *
 * <strong>這不是唯一一道防線。</strong>正式部署時對外 port 才對外開放、內部 port
 * 只綁內網；這一支是萬一防火牆設錯時的第二道，也是本機同時跑兩個 port 時的依據。
 */
@Injectable()
export class ExternalPortGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /**
   * 對外 port。未設定就代表沒有開對外 port，這道守衛整個不作用。
   *
   * 讀環境變數而不是注入設定：這支守衛在每一個請求上都會跑，而且必須與
   * <code>main.ts</code> 實際綁定的 port 是同一個值來源。
   */
  private static externalPort(): number | null {
    const raw = (process.env.EXTERNAL_PORT ?? '').trim();
    if (!raw) return null;
    const port = Number(raw);
    return Number.isInteger(port) && port > 0 ? port : null;
  }

  canActivate(context: ExecutionContext): boolean {
    const externalPort = ExternalPortGuard.externalPort();
    if (externalPort == null) return true;
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<Request>();
    // localPort＝這個連線打進來的是哪一個 port，不是對方的來源 port
    const localPort = request.socket?.localPort;
    if (localPort !== externalPort) return true;

    const isExternal = this.reflector.getAllAndOverride<boolean>(
      EXTERNAL_API_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isExternal) return true;

    throw new NotFoundException('Cannot ' + request.method + ' ' + request.url);
  }
}
