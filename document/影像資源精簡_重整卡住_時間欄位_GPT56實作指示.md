# 影像資源管理精簡、網頁重整與共用時間欄位修正

交付對象：GPT 5.6。日期：2026-10-22。

請依本文件直接完成前後端實作、必要資料遷移與驗證。這是本輪需求的準據；先讀專案規範、目前工作目錄與既有修改，不覆蓋其他人的工作。使用者提供的截圖作為介面問題參考。

本文件取代舊影像規格中「全域來源預設、批次套用、讓使用者設定連線範圍、影像資源多條件查詢列」的設計。其他逐筆來源、監控、歷史錄影功能沿用。完成後同步修正舊規格相關段落，不可保留兩套互相矛盾的有效指示。

## 1. 本次要完成的結果

1. 影像資源管理頂部只保留一個多選標籤下拉選擇器，預設全部，選擇後直接更新清單。
2. 移除名稱／載具／位置關鍵字、啟用狀態、上線狀態篩選，以及搜尋、重置；刪除對應的無用狀態、請求參數與後端專屬篩選分支。
3. 完整移除全域來源預設、連線範圍的使用者設定與批次套用功能；來源一筆一筆設定，不只藏按鈕。
4. 頂部重新排整齊，保留新增、歷史錄影入口及真實錄影儲存狀態。
5. 查明並修復瀏覽器重整卡住，保留正確的按需載入功能。
6. 全站共用時間輸入呈現一致：完整日期與時間保持一行，寬度不足時整個欄位換列，不能在日期中間斷行。

## 2. 已檢查到的現況與證據

### 2.1 影像頁目前程式

- `frontend/src/features/video/VideoResourcesPage.tsx` 還有 draft/filters、搜尋／重置、三個查詢欄位、下方來源標籤按鈕列，以及 DefaultsDialog 入口。
- `frontend/src/components/SiteSelect.tsx` 是單選元件，Props 明確排除 multiple。不可直接把 string[] 塞進現有 value 或加 multiple 就宣稱多選完成。
- `backend/src/video/video-config.service.ts` 的 querySources 已有標籤 OR 條件：任一選取標籤符合即可；還有 q、enabled、online 篩選分支。
- 全域功能涵蓋 DefaultsDialog、前端 API、controller 的 defaults/settings/preview-apply/apply、config service、VideoSourceDefaults entity 與資料表，不是單一按鈕。
- `allowedNetworks` 目前也被逐筆新增、預覽、reconciler 和媒體來源驗證使用。移除「使用者連線範圍設定」時，需將必要的部署端連線政策從此功能解耦，不能留下失效依賴或為了省事讓所有 URL 任意通過。

### 2.2 網頁重整：已觀測、尚未證實的部分

2026-10-22 本輪讀取本機服務，樣本如下，單位毫秒：

| 資源 | HTTP | first byte／完整回應 |
| --- | --- | --- |
| `http://localhost:5173/` | 200 | 13.7／13.8 |
| `/src/App.tsx` | 200 | 1.8／1.9 |
| `/src/features/schedule-management/index.tsx` | 200 | 93.4／93.5 |
| `/syncdrive-api/auth/me`（Vite proxy） | 200 | 48.5／48.5 |

- 當時 Vite PID 2799、backend PID 2387 都在監聽。Vite 某次 CPU 88.4%，稍後為 0%；這只能是瞬間負載線索，不能直接定為死循環。
- `.dev/frontend.log` 有 02:11–02:12 的 `/socket.io` ECONNREFUSED，之後服務重啟；本輪 proxy 已回應成功。不能拿舊錯誤宣稱目前後端持續離線。
- 最近未提交修改確實新增 App／shell 的 lazy import、Suspense 與 `useCoalescedQuery`。它們需要回歸測試，但僅憑時間先後不能斷定 lazy import 就是根因。
- 本輪在同一 Chrome 新開本機分頁，使用既有登入 session：初見「正在載入工作區…」，後來成功顯示班次資料；接著實際 reload，`load` 等待成功、`document.readyState = complete`。沒有重現永久轉圈。
- 原使用者分頁當時由另一個工作階段控制，未強行操作。因此尚未取得截圖當下那個分頁的 pending request 或故障堆疊。

**不得把「新分頁現在能重整」寫成問題已修復。請完成下面的重現與診斷，交付具體原因；若仍不能重現，明確列出範圍與證據，不可臆造根因。**

### 2.3 時間排版：可直接確認的原因

`frontend/src/components/SiteDateTimeInput.tsx` 的 trigger span 直接顯示 current，所以出現 `2026-10-21T02:14:03`；文字沒有 nowrap，會在連字號等位置換行。

`frontend/src/features/event-log-shared/ui.tsx` 的 RangeFilter 將兩個元件放在 flex 列裡，只給 flex-1、整組 min-width，沒有讓兩端各有足夠且相等的寬度與一致換列規則。因此可能開始時間一行、結束時間兩行。

這是網站自製 button／span 的排版問題，不是瀏覽器原生 datetime-local 控制項。

## 3. 影像資源頁的最終互動與排版

### 3.1 唯一篩選器：來源標籤多選下拉

- 標題「來源標籤」，初始顯示「全部標籤」。空陣列代表不限制標籤，含沒有標籤的來源。
- 打開為網站一致的深色浮層，每個選項可勾選／取消，允許多選；選完不自動關閉，點外部或 Escape 關閉。選單使用既有 AnchoredPopover 與網站勾選風格，不使用原生 select multiple。
- 下拉內有「全部標籤」動作：點選即清空具體選取條件；不讓「全部」和具體標籤同時成為查詢值。無選取自然回到全部，不需要額外重置按鈕。
- 選取標籤 A、B 時，清單顯示具有 A **或** B 的來源；同一來源只出現一次。不是必須同時具備兩標籤。
- 每次變動即套用，頁碼回到第 1 頁，不再保留待搜尋的 draft 狀態，不需要按確定或搜尋。
- trigger 顯示選取摘要；長標籤以省略和「+N」控制寬度，完整標籤可在選單查看，不讓整列高度無限制增加。下拉可有數量 badge，但不能取代勾選狀態。
- 選單項目以完整來源標籤資料建立，不只從當頁 rows 計算；新增、修改、複製、刪除後更新選項與清單。移除已不存在的選取標籤時須重新取正確頁面，避免遺留無法取消的條件。
- 標籤沿用既有 NFKC、空白及大小寫正規化；前端、後端去重一致。不能悄悄截斷使用者選取數量，若 API 有上限需明確限制並說明。
- 清單的資料更新沿用目前 `useCoalescedQuery`，load callback 必須穩定；queryKey 用正規化、排序後的標籤值、page、user/permission scope，不包含刷新計數。快速勾選時舊回應不能蓋過新條件。

優先實作一個精簡的 `SiteMultiSelect` 共用元件，沿用 SiteSelect 與 AnchoredPopover 的外觀和焦點行為，不改壞既有單選 API、不引入選單套件。提供鍵盤上下移動、Space/Enter 切換、Escape 關閉、焦點返回與清楚的可存取名稱；選擇 listbox/multiselect 或 checkbox 語意時須一致，不混用不合法角色。

### 3.2 工具列版型

桌面版同一條工具列：

`來源標籤 [全部標籤 ▾]                 [歷史錄影] [錄影儲存狀態] [+ 新增來源]`

- 下拉在左，右側操作靠右；新增來源是主要藍色按鈕，其餘沿用現有次要按鈕與警示色。
- 同一列控制項使用一致高度、垂直中線與 12–16px 間距。標籤 label 若另佔一行，右側操作應對齊控制項本身，不對齊 label。
- 狹窄視窗讓整個右側操作群換到下一列，依可用空間再自然排列，不能互相擠壓或超出頁面。
- 刪除現有下方整排來源標籤快捷按鈕，避免同頁兩套篩選入口。保留每筆來源的標籤顯示。
- 不移除列表的上線 badge、逐筆啟停、編輯、複製、刪除、儲存錄影狀態；使用者說不用的是「篩選器」，不是這些必要資訊與操作。
- 清單仍不得建立預覽或播放 session；預覽只在逐筆來源設定對話框。
- 移除為批次套用而存在、已無其他用途的列勾選欄與 selected 狀態。若還有真實且保留的用途，先列明，不保留空操作。

## 4. 完整移除全域功能及相關死碼

### 4.1 前端

刪除 DefaultsDialog 檔案及所有引用、defaultsData、advanced 的 defaults 分支、全域 defaults/settings API 方法、ApplyItem/Defaults 等無用型別、批次套用與路徑樣板專用邏輯。將 storage 對話框狀態改成實際仍有需要的狀態，不留下已不可能使用的 union 分支。

`SourceDialog` 新建來源維持自身欄位：連線由使用者填寫，protocol 的一般初始值可以保留；錄影預設勾選 true。不得再讀取全域資料或套用路徑樣板。編輯、密碼保留／明確清除、來源版本、預覽清理均維持。

來源清單 `SourceQuery` 與 request builder 移除 q/enabled/online；只保留必要的 tags/page/pageSize。先查完整呼叫圖，**不要**刪掉監控格來源選單或歷史查詢自己仍有需要的搜尋功能。

### 4.2 後端

檢查並清除：

- `backend/src/video/video.controller.ts`：`GET/PUT defaults`、`POST defaults/preview-apply`、`POST defaults/apply`；使用者修改連線範圍的 settings 路由。
- `backend/src/video/video-config.service.ts`：defaultsRow/getDefaults/updateDefaults/planApply/previewApply/apply、全域批次樣板專用 helpers、無效 invalidation/audit 寫入分支。
- `backend/src/database/entities/video.entities.ts` 內 `VideoSourceDefaults`，及 database/video module 的註冊引用。
- `source-address.ts` 的 renderPathTemplate/sanitizeTemplateVars 等只有全域功能使用的程式；先搜尋所有呼叫者，保留 URL parsing、masking、加解密、host 驗證等仍在逐筆流程使用的能力。
- querySources 內 q/enabled/online 的專屬 SQL 與失效測試；保留穩定排序、分頁、標籤 OR、真實總數與狀態輸出。
- API 文件、專用測試、現行 seed／bootstrap 建立全域預設的程式；既有 audit 歷史紀錄不能刪除，已記錄的動作仍應可讀。

若 settings GET 還被其他模組用於 maxTabs/maxSources，將其保留為只回傳必要限制的契約；不要把仍使用中的配額與設定資料整張刪除。

### 4.3 連線政策處理：使用者不再操作「連線範圍」

最終設計：攝影機允許主機／網段屬於**部署端設定**，不再是本頁或任何使用者可修改的影像功能。

1. 將既有 allowlist 從 VideoSettings 的使用者功能解耦，統一由 video config 的部署設定讀取（例如單一 `VIDEO_ALLOWED_NETWORKS` 環境設定，沿用既有組態模式）。create/edit/test/live/reconciler 全部走同一個解析與驗證函式，不各寫一套。
2. 遷移前讀取目前資料庫已設定的有效清單，產生管理者可檢查的部署設定變更；必須保留本機模擬器／MediaMTX 及正式攝影機現有可用來源。不要只套用預設私網而讓現在合法來源失效。
3. 沿用現有預設政策與禁止 metadata／危險位址等檢查，不把空 allowlist 改成任意放行，不新增一個取代舊入口的使用者連線設定畫面。
4. 完成部署組態搬移及檢查後，移除不再使用的資料庫 allowed_networks 欄位／updateSettings 邏輯；若部署尚未配置到位，必須明確交付阻擋條件與搬移命令，不得先刪唯一的有效設定導致現有來源斷線。
5. 連線不符政策時逐筆設定對話框仍需顯示可理解錯誤；不要求一般使用者先設定全域項目才能新增來源。

### 4.4 資料庫遷移與部署

新增 forward migration 並登記 `deploy/migrations/order.txt`，不得改寫已交付 migration 的歷史內容。清理不再使用的 `video_source_defaults` 與專用 schema 前確認依賴、先備份；絕不能刪到 video_sources、revisions、tabs、tiles、recordings 或配額設定。

同步更新 entity、module 註冊、migration、部署組態及文件，避免 TypeORM synchronize 在本機把移除的表重新建回來。既有逐筆來源已保存的 revision 必須保留，舊的全域樣板不能再影響它們。

## 5. 重整卡住：必須先取證再修復

### 5.1 區分四種情況

1. 主文件／script/style 還 pending，瀏覽器沒有完成 load。
2. load 已完成，但 auth 或 lazy module 等不到，React 停在 fallback。
3. load 已完成，但清單 API／effect／狀態循環讓畫面沒有更新。
4. 只是 websocket／long-poll 常駐連線。正常即時連線本來就不保證 networkidle，不能把它當作頁面必須永遠載入。

記錄問題分頁的 document.readyState、DOM 可操作狀態、pending 資源種類、URL、initiator、HTTP 狀態、console stack、Vite/backend 同時段日誌。不要保存或交付含 session／密碼的完整 HAR。

### 5.2 查核優先順序

- 重現一般 reload 與 hard reload，冷／暖啟動分開，登入及已登入兩種情境，先在使用者出問題的班次頁，再查事件／影像／日誌。
- 對照目前未提交 diff：`App.tsx`、`schedule-management/index.tsx`、lazy 化的頁面 export、`useCoalescedQuery.ts` 及其呼叫者。驗證 default/named export adapter、import 大小寫、間接循環與 CSS 匯入。
- lazy 必須宣告在模組頂層，不能每 render 建立。動態 import 失敗要進錯誤邊界、能明確恢復，不能以永久 fallback 或無限 reload 重試。
- 檢查 App 的背景 `import('./lib/migrateLocalCacheToServer')` rejection 處理；背景遷移不能阻擋頁面。不要直接刪除遷移而讓既有資料不能讀取。
- `useCoalescedQuery` effect 依賴 load，所有使用者的 load callback 須有穩定依賴；排除 inline 函式造成 abort/refetch 循環，並檢查 refresh/invalidation 是否自我觸發。這是候選路徑，不是已確認故障。
- 找出 Vite 對應 pending module 的 transform／依賴最佳化問題，再決定是否需要修 import、依賴掃描或限定範圍清快取。不要直接全站取消 lazy、盲目新增 optimizeDeps 或以清 Chrome 所有資料作為修法。
- 檢查被延遲的靜態資源、iframe/image/video 與初始化連線是否意外卡住 load；對真正無期限的有限請求加有界逾時、取消與錯誤恢復。不要對正常串流套一般短逾時。
- Socket.IO／播放器卸載時清理，但不要為消除 Chrome 轉圈而禁止即時資料、stop window loading、攔截 F5 或重寫瀏覽器重整。

本機可用資源現在有回應，不能跳過以上流程就聲稱「一定是後端離線」或「GPT 5.6 lazy 寫壞」。如果故障需要冷啟動才能出現，先記錄狀態，再在不干擾其他工作的方式重現；不要任意重啟使用者整套服務。

## 6. 共用時間欄位的統一修正

### 6.1 顯示與資料格式分離

修改 `frontend/src/components/SiteDateTimeInput.tsx`：

- datetime-local 視覺顯示 `YYYY-MM-DD HH:mm:ss`（依現有 step/秒精度契約），date 顯示 `YYYY-MM-DD`，time 顯示 `HH:mm` 或 `HH:mm:ss`。
- value/onChange、data-site-datetime-value 與 hidden input 仍使用原本的 `YYYY-MM-DDTHH:mm:ss` 格式，不能把 UI 空白格式送進既有 parser。
- 這些是已按網站時區產生的 wall-clock 欄位字串，顯示格式只做確定的字串拆分，不用 new Date(value).toISOString() 轉換，避免時區及日期被改動。
- trigger 日期文字 `whitespace-nowrap`、tabular-nums，圖示固定 shrink-0；避免父層 break-all／flex 收縮把日期折開。不能只加 nowrap 然後讓內容溢出。
- 保持 min/max、disabled、焦點、onChange、name、無障礙名稱及深色日期面板。不要為改外觀更換資料契約或自動補改使用者輸入。

### 6.2 RangeFilter 必須等寬並成組換列

修改 `frontend/src/features/event-log-shared/ui.tsx` 的 RangeFilter／必要的 FilterField 寬度契約：

- 寬畫面採 `minmax(0,1fr) auto minmax(0,1fr)` 結構：開始、至、結束；兩端等寬、同高度、日期時間全部單行。
- 容器必須有足夠寬度：依 14px 字體、內距與圖示計算完整 19 字元的欄位空間，建議每端約 16–18rem，再以實際網站字型及 125%/150% 縮放檢查。
- 不夠寬時在父容器改成兩列完整欄位，標明開始／結束；不能只讓某一端文字在中間斷行。用容器可用寬度決定（可用既有 responsive/container query），不要只看 viewport，側欄和查詢列也會占空間。
- 外框不超出手機寬度，不依靠水平捲動閱讀日期。極小寬度必要時調整字級與內距，仍不能截掉日期／秒數。
- 查詢按鈕群自己成組換列，與時間欄位間距一致；時區／「含結束那一秒」的說明可獨立小字一列，不能擠壓兩端輸入。
- 修正 RangeFilter 現在以 label 包住多個控制項的語意，改用 group/fieldset 或明確各自 label，確保兩端各有唯一可存取名稱。

### 6.3 全站掃描與回歸範圍

至少檢查以下使用者，而不是只在營運日誌補 CSS：

- 日誌 `features/log-management/LogPage.tsx` 各 category。
- 歷史事件 `features/event-management/HistoryEventsPage.tsx`。
- 歷史錄影 `features/video/VideoHistoryPage.tsx`。
- 運行管理紀錄 `features/vehicle-run-history/QueryPanel.tsx`。
- 媒體排程 `ScheduleEditorDialog.tsx`、`WeeklyTimesDialog.tsx`。
- 班表調整 `shift-deployment/components/ScheduleAdjustApplyDialog.tsx`。
- 系統設定 `system-foundation/components/SettingsFormControls.tsx`、儀表板 PropertiesPanel 的 date/time 欄位。
- 班次紀錄自身的 DateTimeRangePicker 若是獨立實作，檢查一致性，但不為形式統一重寫已正常的互動。

共用 CustomDateTimePanel 目前接收 Date，日期／時間模式與網站時區的既有選擇行為也需回歸；本次排版不得把網站時區改成瀏覽器時區。保持 rangeToQuery 的 `[from,to)` 與「包含結束那一秒」語意，不能因改顯示而縮短／延長查詢。

## 7. 驗收與交付

### 必要功能測試

- 全部標籤包含無標籤來源；A/B 多選為 OR、沒有重複列；變動重設頁碼；取消全部恢復完整列表。
- 選單鍵盤、多選摘要、長標籤、無標籤、跨頁、快速改條件與來源刪除的行為。
- 前後端不再有可呼叫的全域 defaults/preview/apply 功能，不再送 q/enabled/online 清單參數；專用死碼確實移除。
- 新增／修改／複製／啟停／預覽／錄影設定仍正常；既有模擬器來源與錄影可讀，配額與來源驗證仍有效。
- 時間元件可見格式、原始提交格式、兩端等寬、秒精度、空值、min/max、不同網站時區與 query 邊界不變。

### 瀏覽器驗證

- 一般與 hard reload、冷與暖各測，觀察 load 完成及內容能互動；登入及已登入都測。測試等待用 load/明確內容條件，不用 networkidle 判定串流網站是否成功。
- 重整卡住必須交付故障 URL／initiator／堆疊或確切 effect 循環等根因及修正證據；若未重現，明確寫未重現，不把猜測算完成。
- 桌面 1440px、1024px、窄容器及 375px，100%/125%/150% 縮放檢查頂部工具列與所有共用時間使用者；不能靠縮小整個網站字體解決。
- 至少保留影像資源頂部、營運日誌時間列、另一個共用時間頁的修正後截圖，以及重整成功的證據。先遮蔽憑證與敏感資料。
- 相關前後端測試、型別／lint、production build。現有 LogPage 等測試 mock 了 SiteDateTimeInput，無法驗出真實顯示問題，需補實際共用元件的測試；排版以真瀏覽器檢查，不能只依 jsdom。

### 完成報告

說明修改檔案、已刪除的前後端功能、遷移與部署步驟、重整問題的已證實原因或仍未重現的限制、測試與截圖。不得宣稱本輪僅撰寫文件就已完成修正，也不得自行部署、清資料或覆蓋其他工作中的修改。
