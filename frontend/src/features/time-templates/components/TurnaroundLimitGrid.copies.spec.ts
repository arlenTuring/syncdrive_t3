import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// tsx 走 CJS，JSX runtime 沒有自動注入 React；這支測試不寫 JSX，但元件內部有
globalThis.React = React;

import { TurnaroundLimitGrid } from './TurnaroundLimitGrid';

/**
 * 格線是日循環無限捲動的（左右各接一份一模一樣的一天），折返時限這一列
 * 必須跟著複製——只畫一份的話，捲到側邊那份時它會憑空消失，而側邊那份
 * 看起來跟中間完全一樣，使用者只會覺得「這條線有時候在有時候不在」。
 */
describe('TurnaroundLimitGrid 的日拷貝', () => {
  const render = (dayCopyCount: number) =>
    renderToStaticMarkup(
      createElement(TurnaroundLimitGrid as never, {
        tasks: [],
        intervals: [],
        attributes: [],
        slotWidthPx: 10,
        rowLabelWidth: 48,
        estimatedTripSeconds: 600,
        dayCopyCount,
      } as never),
    );

  /** 每一份軌道都是一個 relative shrink-0 的容器 */
  const countTracks = (html: string) => (html.match(/relative shrink-0/g) ?? []).length;

  it('要幾份就畫幾份', () => {
    assert.equal(countTracks(render(3)), 3);
  });

  it('沒給就畫一份，維持原本行為', () => {
    assert.equal(
      countTracks(
        renderToStaticMarkup(
          createElement(TurnaroundLimitGrid as never, {
            tasks: [], intervals: [], attributes: [],
            slotWidthPx: 10, rowLabelWidth: 48, estimatedTripSeconds: 600,
          } as never),
        ),
      ),
      1,
    );
  });
});
