# 設計交付文件（原檔）

設計提供的原始規格，程式實作以這裡為準。**不要手改這些檔**；設計更新時整份換掉，再同步程式。
每份文件跟程式的對應登記在 `manifest.json`，`src/components/ui/designSpecs.spec.ts` 會依此檢查：

- CSS 跟文件 §5 逐字一致。
- 用到的 token 都存在。
- 元件有匯出。
- CSS 有被 `components/ui/styles.css` 引入。

| 檔案 | 內容 | 程式實作 |
|---|---|---|
| `t3-design-tokens.source.css` | 字型、顏色系統（Syncdrive UI Design Kit，2026-11-12） | `src/styles/design-tokens.css` |
| `t3-text-button-engineering-spec.md` | Button：3 Hierarchy × 5 Style × 4 State（60） | `src/components/ui/button/` |
| `t3-icon-button-engineering-spec.md`＋`-playground.html` | IconButton：2 Size × 3 Hierarchy × 5 Style × 5 State（150） | `src/components/ui/button/` |
| `t3-checkbox-engineering-spec.md`＋`-playground.html` | Checkbox：2 Size × 2 Style × 3 Select × 4 State（42） | `src/components/ui/checkbox/` |
| `t3-radio-engineering-spec.md`＋`-playground.html` | Radio Basic：2 Size × 2 Select × 4 State（16） | `src/components/ui/radio/` |
| `t3-switch-engineering-spec.md`＋`-playground.html` | Switch：2 Configuration × 2 Select × 3 State（12） | `src/components/ui/switch/` |

## 用設計的對照頁驗收實作

```bash
npm run check:design-specs
```

這個指令會建置前端，並把每個 playground 接上 app 實際的 CSS，產生在 `dist/design-check/`。
開 `http://localhost:5173/design-check/`，每頁的「自動檢查」都應該全數通過。

目前結果：IconButton 14/14、Checkbox 42/42、Radio 16/16、Switch 12/12。

## 新增一份元件規格

1. 把 `*-engineering-spec.md`（和 playground）放進這個資料夾。
2. 在 `src/components/ui/<元件>/` 建元件與 CSS。CSS 逐字取自文件 §5，外包 `@layer components`。
3. 在 `src/components/ui/styles.css` 加一行 `@import`。
4. 從 `src/components/ui/index.ts` 匯出元件。
5. 在 `manifest.json` 登記一筆。
6. 跑 `npm test` 和 `npm run check:design-specs`。
