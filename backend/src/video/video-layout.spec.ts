import { BadRequestException } from '@nestjs/common';
import { CANVAS, duplicateName, normalizeTags, parseAspect, parseLayout, tagKey } from './video-layout';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const half = [
  { x: 0, y: 0, w: 5000, h: CANVAS },
  { x: 5000, y: 0, w: 5000, h: CANVAS },
];

describe('video layout validation', () => {
  it('accepts tiles that only share an edge and keeps their order as position', () => {
    const tiles = parseLayout(half.map((r, i) => ({ ...r, tileId: id(i + 1) })));
    expect(tiles.map((t) => t.position)).toEqual([0, 1]);
    expect(tiles[1].tileId).toBe(id(2));
  });

  it('rejects overlap, out of bounds, too small, non-integer, NaN, duplicate ids, empty and a 13th tile', () => {
    const bad: unknown[] = [
      [{ x: 0, y: 0, w: 6000, h: CANVAS }, { x: 5000, y: 0, w: 5000, h: CANVAS }],
      [{ x: 5000, y: 0, w: 5001, h: CANVAS }],
      [{ x: -1, y: 0, w: 1000, h: 1000 }],
      [{ x: 0, y: 0, w: 499, h: 1000 }],
      [{ x: 0.5, y: 0, w: 1000, h: 1000 }],
      [{ x: Number.NaN, y: 0, w: 1000, h: 1000 }],
      [{ x: '0', y: 0, w: 1000, h: 1000 }],
      half.map((r) => ({ ...r, tileId: id(1) })),
      [],
      Array.from({ length: 13 }, (_, i) => ({ x: (i % 4) * 2500, y: Math.floor(i / 4) * 2000, w: 2500, h: 2000 })),
      'not-an-array',
    ];
    for (const layout of bad) expect(() => parseLayout(layout)).toThrow(BadRequestException);
  });

  it('accepts exactly 12 tiles and canvas aspect ratios in range', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => ({ x: (i % 4) * 2500, y: Math.floor(i / 4) * 3333, w: 2500, h: 3333 }));
    expect(parseLayout(twelve)).toHaveLength(12);
    expect(parseAspect(undefined)).toBeCloseTo(16 / 9, 3);
    expect(() => parseAspect(10)).toThrow(BadRequestException);
  });
});

describe('source tags', () => {
  it('trims, drops empties, dedupes width/case variants and keeps the first spelling', () => {
    expect(normalizeTags(['  前門 ', '', 'Gate', 'ＧＡＴＥ', 'gate', '前門'])).toEqual(['前門', 'Gate']);
    expect(tagKey('Ｂｕｓ  Stop')).toBe('bus stop');
  });

  it('limits to 10 tags of 30 characters', () => {
    expect(() => normalizeTags(Array.from({ length: 11 }, (_, i) => `t${i}`))).toThrow(BadRequestException);
    expect(() => normalizeTags(['字'.repeat(31)])).toThrow(BadRequestException);
    expect(() => normalizeTags('a')).toThrow(BadRequestException);
  });

  it('duplicate names keep the full suffix within the length limit', () => {
    expect(duplicateName('前門攝影機')).toBe('前門攝影機的複製');
    const long = duplicateName('名'.repeat(120));
    expect([...long]).toHaveLength(120);
    expect(long.endsWith('的複製')).toBe(true);
  });
});
