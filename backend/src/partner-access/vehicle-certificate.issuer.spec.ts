import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import {
  positiveSerialNumber,
  VehicleCertificateIssuer,
} from './vehicle-certificate.issuer';

describe('VehicleCertificateIssuer', () => {
  it('encodes positive serial numbers without redundant DER padding', () => {
    expect(positiveSerialNumber(Buffer.from('01'.repeat(16), 'hex'))).toBe('01'.repeat(16));
    expect(positiveSerialNumber(Buffer.from('ff'.repeat(16), 'hex'))).toBe(`7f${'ff'.repeat(15)}`);
    expect(positiveSerialNumber(Buffer.alloc(16))).toBe(`01${'00'.repeat(15)}`);
  });

  it('issues a certificate accepted by OpenSSL', () => {
    const config = new ConfigService({ MQTT_CERT_DIR: '../mosquitto/certs' });
    const issuer = new VehicleCertificateIssuer(config);
    const issued = issuer.issue('PMS99', Date.now() + 60_000);

    const cert = new crypto.X509Certificate(issued.certificate);
    expect(cert.subject).toContain('CN=PMS99');
    expect(Number.parseInt(cert.serialNumber.slice(0, 2), 16)).toBeLessThan(0x80);
    expect(cert.serialNumber).not.toMatch(/^00/);
  });
});
