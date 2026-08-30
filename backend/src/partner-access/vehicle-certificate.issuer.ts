import { generateKeyPairSync, randomBytes } from 'crypto';
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as forge from 'node-forge';

export type IssuedClientCertificate = {
  vehicle_code: string;
  certificate: string;
  private_key: string;
  not_before: number;
  not_after: number;
};

/**
 * 車輛客戶端憑證的即時簽發。
 *
 * <h3>為什麼不預先簽好</h3>
 * 預簽的憑證只有一個效期，而效期到期那天該台車就直接連不上 broker，沒有預警。
 * 改成申請金鑰時一併簽發之後，憑證的效期等於那次申請的 <code>ttl_minutes</code>
 * ——換金鑰與換憑證變成同一個動作，不會出現「金鑰還有效但憑證過期」的半殘狀態。
 *
 * <h3>用中介 CA 簽，不用根</h3>
 * 這支程式握有一把能簽出任何車輛身分的私鑰。若那把是根 CA，本服務一旦被攻破，
 * 攻擊者還能簽出伺服器憑證冒充 broker，中間人就成立了。所以簽發權只給中介 CA：
 * 根只簽中介與伺服器憑證，且應離線保存；中介外流時撤銷重簽即可，不必更換所有
 * 車端已知的信任錨點。
 *
 * <h3>金鑰產生走原生 crypto，憑證組裝走 forge</h3>
 * forge 的純 JS RSA 金鑰產生要數秒，一次申請十一台就是十幾秒。原生
 * <code>generateKeyPairSync</code> 走的是 OpenSSL，同樣的事情約一百毫秒。
 * Node 沒有建立 X.509 的 API，所以憑證本體仍由 forge 組裝與簽章。
 */
@Injectable()
export class VehicleCertificateIssuer {
  private readonly logger = new Logger(VehicleCertificateIssuer.name);
  private cached: {
    cert: forge.pki.Certificate;
    key: forge.pki.rsa.PrivateKey;
    /** 快取當時中介私鑰的 mtime。檔案被續簽換掉時用它判斷要重讀。 */
    keyMtimeMs: number;
  } | null = null;

  constructor(private readonly config: ConfigService) {}

  private certDir(): string {
    return this.config.get<string>('MQTT_CERT_DIR', '/mqtt-certs');
  }

  private read(name: string): string | null {
    const path = join(this.certDir(), name);
    if (!existsSync(path)) return null;
    try {
      return readFileSync(path, 'utf8');
    } catch (error) {
      this.logger.error(`讀不到 ${path}：${(error as Error).message}`);
      return null;
    }
  }

  /**
   * 給車端用來驗證 broker 的信任錨點。
   *
   * 讀的是 ca-published.crt 而不是 ca.crt——前者是 deploy/mqtt-certs.sh 維護的
   * <strong>集合</strong>，包含現行根、接班根，以及尚未過期的舊根。
   *
   * 根憑證每十年要換一次，而換的那一刻如果車端只信任舊的那一把，就會在沒有任何
   * 改動的情況下集體斷線。所以換根分兩階段：先把新根加進這個集合公布 30 天，
   * 讓每天換憑據的車端都拿到，之後才真正改用新根簽發。這支端點交付的是集合，
   * 車端把整份設為信任錨點即可，不需要知道現在處於哪個階段。
   *
   * 舊部署可能還沒有這個檔，退回 ca.crt。
   */
  rootCertificate(): string | null {
    return this.read('ca-published.crt') ?? this.read('ca.crt');
  }

  /**
   * 中介 CA。車輛憑證的簽發者，車端接在自己的憑證之後送出，broker 才能把那張
   * 憑證追溯到根。
   */
  intermediateCertificate(): string | null {
    return this.read('client-ca.crt');
  }

  /**
   * 目前的中介 CA，解析後快取。
   *
   * 解析 PEM 每次要花幾十毫秒，一次申請要簽十一張，所以值得快取。但<strong>不能
   * 永久快取</strong>：中介每年會被 deploy/mqtt-certs.sh 自動續簽換掉，而換掉之後
   * 這裡若還拿著舊的那把私鑰，簽出來的車輛憑證就與同一包裡交付的
   * intermediate_certificate（讀檔案，永遠是新的）對不起來——車端送出的鏈接不上，
   * 而症狀要等到舊中介真的過期才會變成連不上，中間隔了好幾年。
   *
   * 所以比對私鑰檔的 mtime，變了就重讀。續簽是把檔案原地覆寫，mtime 一定會動。
   */
  private issuer(): { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey } {
    const keyPath = join(this.certDir(), 'client-ca.key');
    const mtime = existsSync(keyPath) ? statSync(keyPath).mtimeMs : 0;
    if (this.cached && this.cached.keyMtimeMs === mtime) return this.cached;
    if (this.cached) {
      this.logger.log('中介 CA 已更換，重新載入簽發用金鑰');
    }
    const certPem = this.read('client-ca.crt');
    const keyPem = this.read('client-ca.key');
    if (!certPem || !keyPem) {
      throw new ServiceUnavailableException(
        '中介 CA 尚未產生或未掛載到中心端，無法簽發車輛憑證（deploy/mqtt-certs.sh）',
      );
    }
    this.cached = {
      cert: forge.pki.certificateFromPem(certPem),
      key: forge.pki.privateKeyFromPem(keyPem) as forge.pki.rsa.PrivateKey,
      keyMtimeMs: mtime,
    };
    return this.cached;
  }

  /**
   * 簽一張憑證給指定車輛。
   *
   * CN 必須等於車輛代號：broker 開了 use_identity_as_username，會拿 CN 當 MQTT 的
   * username，而 ACL 用 username 比對可發布的路徑。CN 打錯的那台車連得上，但發布
   * 全被拒——症狀是「連上了卻什麼資料都沒進來」，很難查。
   */
  /**
   * 簽一張車輛憑證。
   *
   * expiresAt 由呼叫端傳<strong>絕對時間</strong>，不是在這裡用 Date.now() 加 TTL——
   * 一次申請要簽十一張，各自算的話每張的到期時間都差幾百毫秒，而且整批會比金鑰
   * 本身早幾秒失效（實測 4.4 秒）。差幾秒不會出事，但「憑證與金鑰同時失效」是
   * 對外文件寫明的保證，讓它真的成立比解釋那幾秒容易。
   */
  issue(vehicleCode: string, expiresAt: number): IssuedClientCertificate {
    const { cert: caCert, key: caKey } = this.issuer();

    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const notBefore = new Date();
    // 往前挪一分鐘，避免車端與中心端有幾秒時鐘差時憑證「還沒生效」
    notBefore.setMinutes(notBefore.getMinutes() - 1);
    const notAfter = new Date(expiresAt);

    const cert = forge.pki.createCertificate();
    cert.publicKey = forge.pki.publicKeyFromPem(publicKey);
    // 序號必須是正整數；最高位設 0 避免被當成負數
    cert.serialNumber = `00${randomBytes(16).toString('hex')}`;
    cert.validity.notBefore = notBefore;
    cert.validity.notAfter = notAfter;
    cert.setSubject([
      { shortName: 'C', value: 'TW' },
      { shortName: 'O', value: 'SyncDrive T3' },
      { shortName: 'CN', value: vehicleCode },
    ]);
    cert.setIssuer(caCert.subject.attributes);
    cert.setExtensions([
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', critical: true, digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', clientAuth: true },
    ]);
    cert.sign(caKey, forge.md.sha256.create());

    return {
      vehicle_code: vehicleCode,
      certificate: forge.pki.certificateToPem(cert),
      private_key: privateKey,
      not_before: notBefore.getTime(),
      not_after: notAfter.getTime(),
    };
  }
}
