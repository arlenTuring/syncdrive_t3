import { generateKeyPairSync, randomBytes } from 'crypto';
import { existsSync, readFileSync } from 'fs';
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
 * 車輛用戶端憑證的即時簽發。
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
  private cached: { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey } | null = null;

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

  /** 給車端用來驗證 broker 的信任錨點。是<strong>根</strong>，不是中介。 */
  rootCertificate(): string | null {
    return this.read('ca.crt');
  }

  /**
   * 中介 CA。車端的憑證鏈需要它才驗得到根，所以要一併交付。
   *
   * broker 那側的 cafile 也含中介，但那只解決 broker 驗車端；車端驗自己這條鏈
   * 時仍然需要它。
   */
  intermediateCertificate(): string | null {
    return this.read('client-ca.crt');
  }

  private issuer(): { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey } {
    if (this.cached) return this.cached;
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
  issue(vehicleCode: string, ttlMinutes: number): IssuedClientCertificate {
    const { cert: caCert, key: caKey } = this.issuer();

    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const notBefore = new Date();
    // 往前挪一分鐘，避免車端與中心端有幾秒時鐘差時憑證「還沒生效」
    notBefore.setMinutes(notBefore.getMinutes() - 1);
    const notAfter = new Date(Date.now() + ttlMinutes * 60_000);

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
