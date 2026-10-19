import { buildSourceUrl, checkHostAllowed, maskedSourceUrl, normalizePath, parseSourceUrl, renderPathTemplate } from './source-address';
import { decryptSecret, encryptSecret, signToken, verifyToken } from './video-secrets';

describe('影像來源位址', () => {
  it('完整網址拆出帳密；遮蔽後不含密碼；組回給媒體服務的網址', () => {
    const { address, password } = parseSourceUrl('rtsp://admin:p%40ss@10.20.0.10:554/cameras/front01/main');
    expect(address).toMatchObject({ protocol: 'rtsp', host: '10.20.0.10', port: 554, path: '/cameras/front01/main', username: 'admin' });
    expect(password).toBe('p@ss');
    expect(maskedSourceUrl(address, true)).toBe('rtsp://admin:***@10.20.0.10:554/cameras/front01/main');
    expect(buildSourceUrl(address, password)).toBe('rtsp://admin:p%40ss@10.20.0.10:554/cameras/front01/main');
  });

  it('拒絕非影像協定與路徑穿越', () => {
    expect(() => parseSourceUrl('file:///etc/passwd')).toThrow();
    expect(() => parseSourceUrl('gopher://x')).toThrow();
    expect(() => normalizePath('/a/../b')).toThrow();
    expect(() => normalizePath('/a b')).toThrow();
  });

  it('樣板只接受白名單變數與安全值', () => {
    expect(renderPathTemplate('/cameras/{cameraId}/main', { cameraId: 'front01' })).toBe('/cameras/front01/main');
    expect(() => renderPathTemplate('/x/{constructor}', {})).toThrow(/只支援/);
    expect(() => renderPathTemplate('/x/{cameraId}', { cameraId: '$(rm -rf /)' })).toThrow();
    expect(() => renderPathTemplate('/x/{index}', {})).toThrow(/需要/);
  });

  it('連線範圍：區網攝影機在允許網段可用；loopback、metadata、未允許網段與 DNS 指向內部位址都拒絕', async () => {
    const allow = ['10.0.0.0/8', '192.168.0.0/16', 'cam.site.local'];
    expect(await checkHostAllowed('10.20.0.10', allow)).toEqual({ ok: true, addresses: ['10.20.0.10'] });
    expect((await checkHostAllowed('127.0.0.1', allow)).ok).toBe(false);
    expect((await checkHostAllowed('169.254.169.254', ['169.254.0.0/16'])).ok).toBe(false);
    expect((await checkHostAllowed('metadata.google.internal', allow)).ok).toBe(false);
    expect((await checkHostAllowed('172.18.0.5', allow)).ok).toBe(false);
    expect((await checkHostAllowed('evil.example.com', allow, async () => ['127.0.0.1'])).ok).toBe(false);
    expect((await checkHostAllowed('cam.site.local', allow, async () => ['172.20.0.9'])).ok).toBe(true);
    expect((await checkHostAllowed('cam.site.local', allow, async () => ['::ffff:127.0.0.1'])).ok).toBe(false);
  });
});

describe('影像密碼與權杖', () => {
  it('密碼加密可還原，密文不含明文', () => {
    const c = encryptSecret('s3cret!');
    expect(c).not.toContain('s3cret');
    expect(decryptSecret(c)).toBe('s3cret!');
  });

  it('權杖驗證種類、簽章與到期', () => {
    const t = signToken({ kind: 'live', sub: 'p', sid: 's', uid: 'u', exp: Date.now() + 1000 });
    expect(verifyToken(t, 'live')?.sub).toBe('p');
    expect(verifyToken(t, 'playback')).toBeNull();
    expect(verifyToken(`${t.split('.')[0]}.x${t.split('.')[1]}`, 'live')).toBeNull();
    expect(verifyToken(signToken({ kind: 'live', sub: 'p', sid: 's', uid: 'u', exp: Date.now() - 1 }), 'live')).toBeNull();
  });
});
