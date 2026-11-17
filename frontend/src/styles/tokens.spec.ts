import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { SEMANTIC_TOKENS, TYPE_SCALE, tokenVar } from './tokens';

const css = readFileSync(new URL('./design-tokens.css', import.meta.url), 'utf8');

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `design-tokens.css 找不到 ${selector}`);
  return css.slice(start, css.indexOf('\n}', start));
}

describe('設計系統 tokens：程式端名稱跟 CSS 一致', () => {
  it('語意色：tokens.ts 的清單＝design-tokens.css :root 裡的變數', () => {
    const names = [...block(':root').matchAll(/^\s*--([a-z0-9-]+):/gm)].map((m) => m[1]);
    assert.deepEqual([...SEMANTIC_TOKENS].sort(), names.sort());
  });

  it('每個語意色都有對應的 Tailwind 顏色（@theme inline）', () => {
    const inline = block('@theme inline');
    for (const name of SEMANTIC_TOKENS) assert.match(inline, new RegExp(`--color-${name}: var\\(--${name}\\);`));
  });

  it('字級：tokens.ts 的清單＝@theme 裡的 --text-*（不含子屬性）', () => {
    const names = [...block('@theme').matchAll(/^\s*--text-([a-z0-9-]+?):/gm)]
      .map((m) => m[1])
      .filter((name) => !name.includes('--'));
    assert.deepEqual([...TYPE_SCALE].sort(), [...new Set(names)].sort());
  });

  it('tokenVar 產生 CSS 變數參照', () => {
    assert.equal(tokenVar('status-error'), 'var(--status-error)');
    assert.equal(tokenVar('color-zinc-900'), 'var(--color-zinc-900)');
  });
});
