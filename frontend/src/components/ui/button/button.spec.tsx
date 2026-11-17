import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, IconButton } from './Button';

const css = readFileSync(new URL('./button.css', import.meta.url), 'utf8');

const HIERARCHIES = ['superior', 'subordinate', 'danger'] as const;
const BUTTON_STYLES = ['filled', 'tonal', 'outlined', 'standard', 'text'] as const;
const ICON_STYLES = ['filled', 'tonal', 'outlined', 'standard', 'icon'] as const;

/** 某個區段（Default／Hover…）裡，這個元件的這組 hierarchy／style 有沒有規則 */
function section(component: 't3-button' | 't3-icon-button', name: string): string {
  const start = css.indexOf(`/* ───────────── ${component === 't3-button' ? 'Button' : 'IconButton'}`);
  const body = css.slice(start, component === 't3-button' ? css.indexOf('/* ───────────── IconButton') : undefined);
  const from = body.indexOf(`/* ${name} */`);
  assert.ok(from >= 0, `${component} 缺少 ${name} 區段`);
  const next = body.indexOf('/* ', from + 4);
  return body.slice(from, next < 0 ? undefined : next);
}

function covers(block: string, component: string, hierarchy: string, style: string, state: string): boolean {
  const selector = `.${component}[data-hierarchy="${hierarchy}"][data-style="${style}"]${state}`;
  return block.includes(selector);
}

/** CSS 跟規格逐字一致、token 存在：見 ../designSpecs.spec.ts。這裡檢查狀態矩陣完整與元件輸出。 */
describe('T3 UI Kit 按鈕樣式', () => {
  it('Button：3 Hierarchy × 5 Style 的 Default、Hover、Pressed、Disabled 都有規則', () => {
    const states = { Default: ' {', Hover: ':where(:hover:not(:disabled))', Pressed: ':where(:active:not(:disabled))', Disabled: ':where(:disabled)' } as const;
    for (const [name, suffix] of Object.entries(states)) {
      const block = section('t3-button', name);
      for (const h of HIERARCHIES) for (const s of BUTTON_STYLES) {
        const hit = name === 'Default'
          ? block.includes(`.t3-button[data-hierarchy="${h}"][data-style="${s}"]`)
          : covers(block, 't3-button', h, s, suffix);
        assert.ok(hit, `Button ${h}／${s} 缺 ${name}`);
      }
    }
  });

  it('IconButton：3 Hierarchy × 5 Style 的 Default、Active、Hover、Pressed、Disabled 都有規則', () => {
    const states = { Default: '', Active: ':where([aria-pressed="true"]:not(:disabled))', Hover: ':where(:hover:not(:disabled))', Pressed: ':where(:active:not(:disabled))', Disabled: ':where(:disabled)' } as const;
    for (const [name, suffix] of Object.entries(states)) {
      const block = section('t3-icon-button', name);
      for (const h of HIERARCHIES) for (const s of ICON_STYLES) {
        assert.ok(covers(block, 't3-icon-button', h, s, suffix), `IconButton ${h}／${s} 缺 ${name}`);
      }
    }
  });

  it('外觀優先序靠規則順序：Default → Active → Hover → Pressed → Disabled', () => {
    const order = ['/* Default */', '/* Active */', '/* Hover */', '/* Pressed */', '/* Disabled */'];
    const icon = css.slice(css.indexOf('/* ───────────── IconButton'));
    const positions = order.map((marker) => icon.indexOf(marker));
    assert.deepEqual([...positions].sort((a, b) => a - b), positions);
    const text = css.slice(0, css.indexOf('/* ───────────── IconButton'));
    const textOrder = ['/* Default */', '/* Hover */', '/* Pressed */', '/* Disabled */'].map((marker) => text.indexOf(marker));
    assert.deepEqual([...textOrder].sort((a, b) => a - b), textOrder);
  });
});

describe('Button／IconButton 元件輸出', () => {
  it('Button：預設 superior／filled、type=button；圖示插槽只在有給時出現', () => {
    const html = renderToStaticMarkup(<Button>查詢</Button>);
    assert.match(html, /class="t3-button text-body-s-bold"/);
    assert.match(html, /data-hierarchy="superior"/);
    assert.match(html, /data-style="filled"/);
    assert.match(html, /type="button"/);
    assert.doesNotMatch(html, /t3-button__icon/);
    const withIcons = renderToStaticMarkup(<Button hierarchy="danger" variant="outlined" leadingIcon={<svg />} trailingIcon={<svg />} disabled>刪除</Button>);
    assert.equal(withIcons.match(/class="t3-button__icon" aria-hidden="true"/g)?.length, 2);
    assert.match(withIcons, /data-hierarchy="danger"/);
    assert.match(withIcons, /disabled=""/);
  });

  it('IconButton：label 變成 aria-label、圖示 aria-hidden；pressed 有給才輸出 aria-pressed', () => {
    const plain = renderToStaticMarkup(<IconButton label="重新整理" icon={<svg />} />);
    assert.match(plain, /aria-label="重新整理"/);
    assert.match(plain, /data-size="medium"/);
    assert.match(plain, /class="t3-icon-button__icon" aria-hidden="true"/);
    assert.doesNotMatch(plain, /aria-pressed/);
    const toggle = renderToStaticMarkup(<IconButton label="固定項目" icon={<svg />} size="small" hierarchy="subordinate" variant="icon" pressed />);
    assert.match(toggle, /aria-pressed="true"/);
    assert.match(toggle, /data-size="small"/);
    const off = renderToStaticMarkup(<IconButton label="固定項目" icon={<svg />} pressed={false} />);
    assert.match(off, /aria-pressed="false"/);
  });
});
