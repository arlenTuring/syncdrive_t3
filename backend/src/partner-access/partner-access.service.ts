import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { PartnerApiKey } from '../database/entities/partner-api-key.entity';
import { VehicleCertificateIssuer } from './vehicle-certificate.issuer';
import { VTMS_VEHICLE_CODES, normalizeVehicleCode } from '../common/vehicle-codes';

/** 預設有效期：24 小時 */
export const DEFAULT_TTL_MINUTES = 24 * 60;
/** 上限 30 天。再長就與「永久金鑰」沒有差別，那正是要避免的東西。 */
export const MAX_TTL_MINUTES = 30 * 24 * 60;
export const MIN_TTL_MINUTES = 1;

export type IssuedToken = {
  api_key: string;
  token_type: 'ApiKey';
  issued_at: number;
  expires_at: number;
  expires_in_minutes: number;
  mqtt: MqttBundle;
};

export type MqttBundle = {
  host: string;
  port: number;
  tls: true;
  /** 信任錨點：車端用它驗證 broker。是根 CA，不是簽車輛憑證的那一張。 */
  ca_certificate: string;
  /** 中介 CA。車端的憑證鏈需要它才接得回根。 */
  intermediate_certificate: string;
  clients: Array<{
    vehicle_code: string;
    certificate: string;
    private_key: string;
    not_before: number;
    not_after: number;
  }>;
};

/**
 * 對外金鑰的發放與查驗。
 *
 * <h3>兩件事一起交付</h3>
 * 廠商拿帳密換到的不只是 REST 金鑰，還有 MQTT 的客戶端憑證。分兩次交付的話，
 * 中間必然出現「金鑰拿到了但憑證還在信箱裡」的狀態，而那兩樣缺一不可——
 * REST 用來拉任務內容，MQTT 用來收指派與回報。一次給完，對方照著就能連上。
 */
@Injectable()
export class PartnerAccessService {
  private readonly logger = new Logger(PartnerAccessService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(PartnerApiKey)
    private readonly keys: Repository<PartnerApiKey>,
    private readonly certificates: VehicleCertificateIssuer,
  ) {}

  private hash(key: string): string {
    return createHash('sha256').update(key, 'utf8').digest('hex');
  }

  /**
   * 帳密比對。
   *
   * 用固定時間比較，不用 <code>===</code>——字串比較會在第一個不同的字元就回傳，
   * 逐字元量測回應時間可以把密碼一個字一個字試出來。長度不同時先補成等長再比，
   * 否則 timingSafeEqual 會直接丟例外，那本身就洩漏了長度。
   */
  private matches(provided: string, expected: string): boolean {
    if (!expected) return false;
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    const length = Math.max(a.length, b.length);
    const padA = Buffer.alloc(length);
    const padB = Buffer.alloc(length);
    a.copy(padA);
    b.copy(padB);
    return timingSafeEqual(padA, padB) && a.length === b.length;
  }

  /**
   * 組出這次要交付的 MQTT 憑據。
   *
   * 車輛憑證在這裡<strong>當場簽</strong>，效期等於這次申請的 ttl_minutes——
   * 換金鑰與換憑證是同一個動作，不會出現「金鑰還有效但憑證過期」的半殘狀態。
   */
  private buildMqttBundle(vehicleCodes: string[], expiresAt: number): MqttBundle {
    const ca = this.certificates.rootCertificate();
    const intermediate = this.certificates.intermediateCertificate();
    if (!ca || !intermediate) {
      throw new ServiceUnavailableException(
        'MQTT 憑證體系尚未建立或未掛載到中心端，請聯絡我方維運（deploy/mqtt-certs.sh）',
      );
    }

    const known = new Set(this.knownVehicleCodes());
    const unknown = vehicleCodes.filter((code) => !known.has(code));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `下列車輛代號不存在：${unknown.join('、')}。請確認代號，或聯絡我方登錄。`,
      );
    }

    return {
      host: this.config.get<string>('MQTT_PUBLIC_HOST', '127.0.0.1'),
      port: Number(this.config.get<string>('MQTT_PUBLIC_PORT', '8883')),
      tls: true,
      ca_certificate: ca,
      intermediate_certificate: intermediate,
      clients: vehicleCodes.map((code) => this.certificates.issue(code, expiresAt)),
    };
  }

  /** 這個環境簽發過憑證的車輛代號 */
  private knownVehicleCodes(): string[] {
    const raw = this.config.get<string>('MQTT_VEHICLE_CODES', '').trim();
    if (raw) return raw.split(',').map((item) => item.trim()).filter(Boolean);
    return [...VTMS_VEHICLE_CODES];
  }

  async issue(input: {
    username: string;
    password: string;
    ttlMinutes?: number;
    vehicleCodes?: string[];
    sourceIp?: string;
  }): Promise<IssuedToken> {
    const expectedUser = this.config.get<string>('EXTERNAL_AUTH_USER', '').trim();
    const expectedPass = this.config.get<string>('EXTERNAL_AUTH_PASSWORD', '').trim();
    if (!expectedUser || !expectedPass) {
      throw new ServiceUnavailableException(
        '中心端尚未設定對外帳號，無法發放金鑰',
      );
    }
    if (
      !this.matches(input.username ?? '', expectedUser)
      || !this.matches(input.password ?? '', expectedPass)
    ) {
      // 不區分「帳號不存在」與「密碼錯誤」——區分等於送出一份帳號是否存在的查詢介面
      throw new UnauthorizedException('帳號或密碼不正確');
    }

    const ttl = this.normaliseTtl(input.ttlMinutes);
    // 廠商手上可能還拿著改名前的 PMS-01，收斂後再比對，不要用「代號不存在」擋在門外；
    // 憑證 CN 一律用新寫法簽發，broker 的 ACL（pattern write v1/vtms/%u/#）才對得上。
    const codes = input.vehicleCodes?.length
      ? input.vehicleCodes.map((code) =>
          normalizeVehicleCode(String(code).trim().toUpperCase()),
        )
      : this.knownVehicleCodes();
    // 到期時間先定下來，金鑰與憑證共用同一個值——兩者必須同時失效
    const issuedAt = Date.now();
    const expiresAt = issuedAt + ttl * 60_000;
    const mqtt = this.buildMqttBundle(codes, expiresAt);

    // 32 bytes 的隨機值。金鑰只在這一刻存在，之後資料庫裡只有它的雜湊。
    const apiKey = randomBytes(32).toString('hex');

    await this.keys.save(
      this.keys.create({
        keyHash: this.hash(apiKey),
        username: input.username,
        issuedAt: String(issuedAt),
        expiresAt: String(expiresAt),
        ttlMinutes: ttl,
        issuedToIp: input.sourceIp ?? null,
        revoked: false,
        lastUsedAt: null,
      }),
    );
    await this.purgeExpired();

    this.logger.log(
      `發出金鑰給 ${input.username}（有效 ${ttl} 分鐘，即時簽發 ${mqtt.clients.length} 張車輛憑證）`,
    );

    return {
      api_key: apiKey,
      token_type: 'ApiKey',
      issued_at: issuedAt,
      expires_at: expiresAt,
      expires_in_minutes: ttl,
      mqtt,
    };
  }

  private normaliseTtl(value?: number): number {
    if (value == null) return DEFAULT_TTL_MINUTES;
    const minutes = Number(value);
    if (!Number.isFinite(minutes) || !Number.isInteger(minutes)) {
      throw new BadRequestException('ttl_minutes 必須是整數（分鐘）');
    }
    if (minutes < MIN_TTL_MINUTES || minutes > MAX_TTL_MINUTES) {
      throw new BadRequestException(
        `ttl_minutes 必須介於 ${MIN_TTL_MINUTES} 與 ${MAX_TTL_MINUTES} 之間（分鐘）`,
      );
    }
    return minutes;
  }

  /**
   * 查驗一把金鑰。
   *
   * 回傳是否有效。過期的當場刪掉——留著只是讓表越來越大，而且「過期但還在」
   * 容易在後續查詢裡被誤當成有效。
   */
  async verify(apiKey: string): Promise<boolean> {
    if (!apiKey) return false;
    const row = await this.keys.findOne({ where: { keyHash: this.hash(apiKey) } });
    if (!row || row.revoked) return false;
    if (Number(row.expiresAt) <= Date.now()) {
      await this.keys.delete({ keyHash: row.keyHash });
      return false;
    }
    // 不 await：更新使用時間失敗不該讓一個合法請求被拒
    void this.keys.update({ keyHash: row.keyHash }, { lastUsedAt: String(Date.now()) });
    return true;
  }

  private async purgeExpired(): Promise<void> {
    try {
      await this.keys.delete({ expiresAt: LessThan(String(Date.now())) });
    } catch (error) {
      this.logger.warn(`清理過期金鑰失敗：${(error as Error).message}`);
    }
  }
}
