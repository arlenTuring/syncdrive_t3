import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import * as forge from 'node-forge';

export type HttpsCertificateStatus = {
  /** 憑證與私鑰皆已安裝且可解析 */
  protected: boolean;
  /** 憑證檔是否存在且可解析 */
  certificatePresent: boolean;
  /** 私鑰檔是否存在（永不回傳內容） */
  privateKeyPresent: boolean;
  /** 公私鑰是否配對成功 */
  keyMatchesCertificate: boolean;
  boundDomain: string | null;
  issuer: string | null;
  expiresAt: string | null;
  /** SHA-256 fingerprint（冒號分隔大寫 hex） */
  fingerprintSha256: string | null;
  updatedAt: string | null;
};

/**
 * 對外傳輸用 TLS 憑證（HTTPS／反向代理掛載）。
 *
 * 私鑰只寫入受限目錄、永不經 API 回傳；狀態僅暴露公開 metadata。
 * MQTT 車輛 mTLS 仍由 MQTT_CERT_DIR + mqtt-certs.sh 管理，與此分離。
 */
@Injectable()
export class HttpsCertificateService {
  private readonly logger = new Logger(HttpsCertificateService.name);

  constructor(private readonly config: ConfigService) {}

  private certDir(): string {
    return this.config.get<string>(
      'HTTPS_CERT_DIR',
      join(process.cwd(), 'https-certs'),
    );
  }

  private certPath(): string {
    return join(this.certDir(), 'tls.crt');
  }

  private keyPath(): string {
    return join(this.certDir(), 'tls.key');
  }

  getStatus(): HttpsCertificateStatus {
    const empty: HttpsCertificateStatus = {
      protected: false,
      certificatePresent: false,
      privateKeyPresent: false,
      keyMatchesCertificate: false,
      boundDomain: null,
      issuer: null,
      expiresAt: null,
      fingerprintSha256: null,
      updatedAt: null,
    };

    const certFile = this.certPath();
    const keyFile = this.keyPath();
    const certificatePresent = existsSync(certFile);
    const privateKeyPresent = existsSync(keyFile);

    if (!certificatePresent) {
      return { ...empty, privateKeyPresent };
    }

    let certPem: string;
    try {
      certPem = readFileSync(certFile, 'utf8');
    } catch (error) {
      this.logger.error(`讀取憑證失敗：${(error as Error).message}`);
      return { ...empty, privateKeyPresent };
    }

    let cert: forge.pki.Certificate;
    try {
      cert = forge.pki.certificateFromPem(certPem);
    } catch (error) {
      this.logger.error(`解析憑證失敗：${(error as Error).message}`);
      return {
        ...empty,
        certificatePresent: true,
        privateKeyPresent,
      };
    }

    let keyMatchesCertificate = false;
    if (privateKeyPresent) {
      try {
        const keyPem = readFileSync(keyFile, 'utf8');
        keyMatchesCertificate = this.privateKeyMatchesCertificate(cert, keyPem);
      } catch (error) {
        this.logger.error(`讀取／比對私鑰失敗：${(error as Error).message}`);
      }
    }

    const { mtimeMs } = statSync(certFile);

    return {
      protected: certificatePresent && privateKeyPresent && keyMatchesCertificate,
      certificatePresent: true,
      privateKeyPresent,
      keyMatchesCertificate,
      boundDomain: this.primaryDomain(cert),
      issuer: this.formatIssuer(cert),
      expiresAt: cert.validity.notAfter.toISOString(),
      fingerprintSha256: this.fingerprintSha256(cert),
      updatedAt: new Date(mtimeMs).toISOString(),
    };
  }

  /**
   * 輪替憑證：寫入 PEM，驗證配對後原子替換。回應永不含私鑰。
   */
  rotate(certificatePem: string, privateKeyPem: string): HttpsCertificateStatus {
    const certPem = certificatePem?.trim() ?? '';
    const keyPem = privateKeyPem?.trim() ?? '';
    if (!certPem.includes('BEGIN CERTIFICATE')) {
      throw new BadRequestException('憑證必須為 PEM 格式（BEGIN CERTIFICATE）');
    }
    if (
      !keyPem.includes('BEGIN PRIVATE KEY') &&
      !keyPem.includes('BEGIN RSA PRIVATE KEY') &&
      !keyPem.includes('BEGIN EC PRIVATE KEY')
    ) {
      throw new BadRequestException('私鑰必須為 PEM 格式（BEGIN PRIVATE KEY）');
    }

    let cert: forge.pki.Certificate;
    try {
      cert = forge.pki.certificateFromPem(certPem);
    } catch {
      throw new BadRequestException('無法解析憑證 PEM');
    }

    if (!this.privateKeyMatchesCertificate(cert, keyPem)) {
      throw new BadRequestException('私鑰與憑證不相符');
    }

    const dir = this.certDir();
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch (error) {
      this.logger.error(`建立憑證目錄失敗：${(error as Error).message}`);
      throw new ServiceUnavailableException('無法寫入憑證目錄');
    }

    const certFile = this.certPath();
    const keyFile = this.keyPath();
    const certTmp = `${certFile}.tmp`;
    const keyTmp = `${keyFile}.tmp`;

    try {
      writeFileSync(certTmp, `${certPem.trim()}\n`, { mode: 0o644, flag: 'w' });
      writeFileSync(keyTmp, `${keyPem.trim()}\n`, { mode: 0o600, flag: 'w' });
      chmodSync(certTmp, 0o644);
      chmodSync(keyTmp, 0o600);
      renameSync(certTmp, certFile);
      renameSync(keyTmp, keyFile);
      chmodSync(certFile, 0o644);
      chmodSync(keyFile, 0o600);
    } catch (error) {
      try {
        if (existsSync(certTmp)) unlinkSync(certTmp);
        if (existsSync(keyTmp)) unlinkSync(keyTmp);
      } catch {
        // ignore cleanup
      }
      this.logger.error(`寫入憑證失敗：${(error as Error).message}`);
      throw new ServiceUnavailableException('寫入憑證失敗');
    }

    this.logger.log(
      `HTTPS 憑證已輪替：${this.primaryDomain(cert) ?? '(no SAN)'} 到期 ${cert.validity.notAfter.toISOString()}`,
    );
    return this.getStatus();
  }

  private privateKeyMatchesCertificate(
    cert: forge.pki.Certificate,
    keyPem: string,
  ): boolean {
    try {
      const key = forge.pki.privateKeyFromPem(keyPem) as forge.pki.rsa.PrivateKey;
      const pub = cert.publicKey as forge.pki.rsa.PublicKey;
      if (!pub?.n || !key?.n) return false;
      return pub.n.compareTo(key.n) === 0 && pub.e.compareTo(key.e) === 0;
    } catch {
      return false;
    }
  }

  private primaryDomain(cert: forge.pki.Certificate): string | null {
    try {
      const ext = cert.getExtension('subjectAltName') as
        | { altNames?: Array<{ type: number; value: string }> }
        | undefined;
      const dns = ext?.altNames
        ?.filter((n) => n.type === 2 && n.value)
        .map((n) => n.value);
      if (dns && dns.length > 0) return dns.join(', ');
    } catch {
      // fall through
    }
    const cn = cert.subject.getField('CN');
    return cn?.value ? String(cn.value) : null;
  }

  private formatIssuer(cert: forge.pki.Certificate): string | null {
    const cn = cert.issuer.getField('CN');
    const o = cert.issuer.getField('O');
    if (cn?.value) return String(cn.value);
    if (o?.value) return String(o.value);
    return null;
  }

  private fingerprintSha256(cert: forge.pki.Certificate): string | null {
    try {
      const asn1 = forge.pki.certificateToAsn1(cert);
      const der = forge.asn1.toDer(asn1).getBytes();
      const md = forge.md.sha256.create();
      md.update(der);
      const hex = md.digest().toHex().toUpperCase();
      return hex.match(/.{2}/g)?.join(':') ?? hex;
    } catch {
      return null;
    }
  }
}
