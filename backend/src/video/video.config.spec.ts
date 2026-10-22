import { videoAllowedNetworks } from './video.config';

describe('影像部署連線政策', () => {
  const original = process.env.VIDEO_ALLOWED_NETWORKS;
  afterEach(() => {
    if (original === undefined) delete process.env.VIDEO_ALLOWED_NETWORKS;
    else process.env.VIDEO_ALLOWED_NETWORKS = original;
  });

  it('正規化、去重並拒絕空設定', () => {
    process.env.VIDEO_ALLOWED_NETWORKS = '10.0.0.0/8, cam.example.com,10.0.0.0/8';
    expect(videoAllowedNetworks()).toEqual(['10.0.0.0/8', 'cam.example.com']);
    process.env.VIDEO_ALLOWED_NETWORKS = '  ';
    expect(() => videoAllowedNetworks()).toThrow(/不可為空/);
  });
});
