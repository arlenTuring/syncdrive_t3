import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * 發給協力廠商的對外 API 金鑰。
 *
 * <h3>為什麼不存金鑰本身</h3>
 * 這張表存的是金鑰的 SHA-256 <strong>雜湊</strong>，不是金鑰。金鑰只在發放當下的
 * HTTP 回應裡出現一次，之後系統自己也算不回來。資料庫被讀走時，拿到的是一堆
 * 雜湊——不能拿去打 API。廠商弄丟就重新申請一把，不需要有人「去查他的金鑰是什麼」。
 *
 * <h3>過期是必要的</h3>
 * 先前對外只有一把寫在環境變數裡的固定金鑰，對所有取用方相同、永不過期。那表示
 * 任何一方外流就等於全部外流，而唯一的補救是換掉那一把、通知所有人一起改。
 * 改成逐把發放並帶有效期之後，外流的影響範圍縮到那一把、那一段時間。
 */
@Entity('partner_api_keys')
@Index('IDX_PARTNER_KEY_EXPIRES', ['expiresAt'])
export class PartnerApiKey {
  /** 金鑰的 SHA-256 十六進位字串。查驗時把來的金鑰做同樣的雜湊再比對。 */
  @PrimaryColumn({ type: 'varchar', length: 64, name: 'key_hash' })
  keyHash: string;

  /** 可操作的車輛；舊金鑰為 null，限原營運車隊，不含測試車。 */
  @Column({ type: 'jsonb', name: 'vehicle_codes', nullable: true })
  vehicleCodes: string[] | null;

  /** 申請這把金鑰的帳號 */
  @Column({ type: 'varchar', name: 'username' })
  username: string;

  @Column({ type: 'bigint', name: 'issued_at' })
  issuedAt: string;

  @Column({ type: 'bigint', name: 'expires_at' })
  expiresAt: string;

  /** 申請時指定的有效時長，分鐘。保留原值供稽核，不是從兩個時間戳回推。 */
  @Column({ type: 'int', name: 'ttl_minutes' })
  ttlMinutes: number;

  /** 申請來源 IP，稽核用 */
  @Column({ type: 'varchar', name: 'issued_to_ip', nullable: true })
  issuedToIp: string | null;

  /** 提前作廢。過期是時間到，作廢是人為決定，兩者要分得開。 */
  @Column({ type: 'boolean', name: 'revoked', default: false })
  revoked: boolean;

  /** 最後一次成功使用的時間，用來看哪些金鑰其實沒人在用 */
  @Column({ type: 'bigint', name: 'last_used_at', nullable: true })
  lastUsedAt: string | null;
}
