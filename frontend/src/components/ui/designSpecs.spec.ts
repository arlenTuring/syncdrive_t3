import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'vitest';

/**
 * 設計規格 ↔ 實作一致性（依 frontend/design-specs/manifest.json）。
 * 新增元件規格：把文件放進 design-specs/、登記 manifest、CSS 由 components/ui/styles.css 引入，這支測試就會管到。
 */

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
type Entry = {
  name: string; spec: string; css: string; component: string; figma: string; variants: number | null; playground: string | null;
  /** playground-assets：規格沒有參考 CSS（例如 Slider），改檢查 CSS 用到的原始素材逐字取自 playground */
  reference?: 'playground-assets';
};
const manifest = JSON.parse(read('design-specs/manifest.json')) as { tokens: { source: string; implementation: string }; components: Entry[] };
const tokens = read(manifest.tokens.implementation);
const index = read('src/components/ui/index.ts');
const styles = read('src/components/ui/styles.css');

const normalize = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean).join('\n');

describe('設計規格與實作一致', () => {
  for (const entry of manifest.components) {
    describe(`${entry.name}（Figma ${entry.figma}${entry.variants == null ? '' : `，${entry.variants} 個 Variant`}）`, () => {
      it('登記的檔案都存在', () => {
        for (const path of [entry.spec, entry.css, entry.component, entry.playground].filter(Boolean) as string[]) {
          assert.ok(existsSync(new URL(path, root)), `${path} 不存在`);
        }
      });

      if (entry.reference === 'playground-assets') {
        it('CSS 用到的原始素材都逐字取自 playground', () => {
          const page = read(entry.playground!);
          const assets = [...read(entry.css).matchAll(/data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+/g)].map((m) => m[0]);
          assert.ok(assets.length > 0, `${entry.css} 沒有素材`);
          for (const asset of assets) assert.ok(page.includes(asset), `${entry.css} 有一張素材不在 ${entry.playground}`);
        });
      } else it('CSS 跟工程文件 §5 參考實作逐字一致', () => {
        const block = read(entry.spec).match(/```css\n([\s\S]*?)```/)?.[1];
        assert.ok(block, `${entry.spec} 找不到 css 區塊`);
        assert.ok(normalize(read(entry.css)).includes(normalize(block)), `${entry.css} 跟 ${entry.spec} 不一致`);
      });

      it('CSS 用到的設計 token 都在 design-tokens.css 裡', () => {
        const css = read(entry.css);
        const local = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!));
        for (const [, name] of css.matchAll(/var\((--[a-z0-9-]+)/g)) {
          if (local.has(name!)) continue;
          assert.match(tokens, new RegExp(`${name}:`), `design-tokens.css 沒有 ${name}`);
        }
      });

      it('元件從 components/ui 匯出、CSS 由 styles.css 引入', () => {
        assert.match(index, new RegExp(`\\b${entry.name}\\b`), `index.ts 沒有匯出 ${entry.name}`);
        const relative = entry.css.replace('src/components/ui/', './');
        assert.ok(styles.includes(`@import '${relative}'`), `styles.css 沒有引入 ${relative}`);
      });
    });
  }

  it('components/ui 底下每支 CSS 都有登記在 manifest、也都由 styles.css 引入', () => {
    const registered = new Set(manifest.components.map((entry) => entry.css));
    for (const folder of readdirSync(new URL('src/components/ui/', root), { withFileTypes: true })) {
      if (!folder.isDirectory()) continue;
      for (const file of readdirSync(new URL(`src/components/ui/${folder.name}/`, root))) {
        if (!file.endsWith('.css')) continue;
        const path = `src/components/ui/${folder.name}/${file}`;
        assert.ok(registered.has(path), `${path} 沒有登記在 design-specs/manifest.json`);
      }
    }
  });

  it('token 原檔有保存', () => {
    assert.ok(existsSync(new URL(manifest.tokens.source, root)));
  });
});
