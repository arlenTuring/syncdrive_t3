import { ENCODER_ARGS, parseVmaf, renditionKey } from './video-archive.service';
import { parseSegmentStart } from './video-storage.service';

describe('video archive helpers', () => {
  it('reads the pooled VMAF score from ffmpeg output', () => {
    expect(parseVmaf('[Parsed_libvmaf_4 @ 0x1] VMAF score: 93.215\n')).toBe(93.215);
    expect(parseVmaf('no score here')).toBeNull();
  });

  it('places renditions next to the original under a name the recorder never produces', () => {
    const key = renditionKey('vs_abc/2026-10-19_01-02-03-000000.mp4', 'av1');
    expect(key).toBe('vs_abc/2026-10-19_01-02-03-000000.mp4.av1.mp4');
    expect(parseSegmentStart(key.split('/').pop()!)).toBeNull();
  });

  it('uses browser-playable encoder settings', () => {
    expect(ENCODER_ARGS.av1.encoder).toBe('libsvtav1');
    expect(ENCODER_ARGS.hevc.args).toEqual(expect.arrayContaining(['-tag:v', 'hvc1']));
  });
});
