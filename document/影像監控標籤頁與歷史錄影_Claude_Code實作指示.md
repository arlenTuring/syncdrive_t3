# 影像資源管理與即時影像監控實作指示

本文件是影像功能唯一有效的製作指示，直接在原檔更新，不另開第二版。本文件包含每個監控標籤頁的整體全螢幕；事件功能的最新規則與執行模型請以同目錄《事件管理與日誌管理實作指示》為準，不沿用舊兩頁分流。Claude Code 請以本文件完成前後端、資料遷移、既有呼叫者與測試；歷次交付紀錄只代表當時結果，不可拿其中的舊設計覆蓋本文件。事件與日誌的非影像功能保留。

本次重整為兩個側欄頁面：「影像資源管理」與「即時影像監控」。來源設定、分類標籤、啟停、錄影與歷史入口都屬於資源管理；即時監控只負責可保存的版面及來源綁定。「來源標籤」是分類文字，「監控標籤頁」是版面，兩者不可混用。

模擬器仍沿用既有 RTSP／HLS／WebRTC 介接，不改 MQTT。模擬器的來源設定、錄影開關與歷史入口若與本文件不同，一律調整為本文件語意。請先讀適用 AGENTS.md、目前程式與本文件再執行，不重建既有媒體平台。

## 一 兩個頁面與明確責任

| 頁面 | 必須提供 | 不應放在此處 |
| --- | --- | --- |
| 影像資源管理 | 分頁來源清單、真實上線狀態、啟停、新增／修改／刪除／直接複製、分類標籤、來源錄影設定、歷史錄影入口 | 清單內的播放器、影像縮圖預覽、多格監控版面 |
| 即時影像監控 | 使用者定義的監控標籤頁、建立／編輯版面對話框、1–12 格拖拉及縮放、每格選用既有來源、播放與臨時全螢幕 | 新建攝影機連線、修改共用來源帳密、每格錄影開關、獨立歷史清單 |

- 「影像監控管理」更名為「即時影像監控」；原「歷史影像查詢」側欄入口改為「影像資源管理」，不保留第三個平行的歷史頁入口。
- 舊 video-monitor／video-history 深連結、事件回放與模擬器操作連結要相容導向；帶 sourceId、from、to、eventId 的歷史連結進資源管理內的歷史子畫面，不能只跳到空白來源清單。
- 不放黃色工程缺項清單。保留現站深色風格、共用下拉、日期控制、對話框與權限通知，空狀態用精準可操作的按鈕。
- 新來源「儲存錄影」預設勾選。從來源啟用且設定生效後即依此決定持續錄影，不依賴是否放進監控格或是否開啟網站。
- 保留每個監控標籤頁最多 12 格，全部可用；不是限制全站只有 12 個來源，也不是限制來源數與車數相同。

## 二 目前程式與修改範圍

目前已實作真實影像管線，不要照舊規格重建空 provider。先讀以下程式及所有呼叫者：

- `frontend/src/features/video/VideoMonitorPage.tsx`、`VideoHistoryPage.tsx`、`TileView.tsx`、`TileSettingsDialog.tsx`、`StorageDialog.tsx`、`layout.ts`、`api.ts`、`status.ts`、`history-link.ts`、`video.spec.ts`。
- `LivePlayer.tsx`、`SegmentFollower.tsx`、`sync.ts`：保留既有 WebRTC/HLS、歷史時間軸與資源釋放；這次要解除 aspect-video／object-contain 對格子版面的控制。
- `frontend/src/features/event-management/EventReplayDialog.tsx`、schedule-management 的 types/index/側欄及 i18n；同步改名與歷史跳轉。
- `backend/src/video/video-config.service.ts`、`video-reconciler.service.ts`、`video.controller.ts`、`video-live.service.ts`、`video-history.service.ts`、`video-storage.service.ts`、`video-archive.service.ts`、`mediamtx.client.ts`。
- `backend/src/database/entities/video.entities.ts`、現有 video migration、`access.constants.ts`、audit catalog、`backend/scripts/video-itest/`、`deploy/migrations/order.txt` 與部署機制。
- frontend/package.json 已有 `react-rnd`，優先沿用作版面編輯，不另外引入第二套拖拉系統。不可將整個正在播放的格子變成拖拉區導致下拉與播放控制失效。

已確認舊 `recordingDemand()` 從格子的 recording_requested／enabled 聚合錄影，`layout.ts` 依格數決定固定欄數，TileView 有 aspect-video。這三點都與本次要求衝突，必須修改後端、資料庫與播放容器，不能只換頁名。

## 三 技術研究結論與選型

本次已查核 MediaMTX、FFmpeg、hls.js、AOMedia、NVIDIA、Netflix VMAF 及 Google Cloud 官方資料。沒有一個編碼器在所有硬體、瀏覽器與場景都最好；本案以「12 格流暢、容量有界、歷史可定位、伺服器可負擔」決定方案，下列參數是本專案的設計初值，須實測，不冒稱供應商保證。

| 層次 | 本次採用 | 原因與條件 |
| --- | --- | --- |
| 媒體接入 | MediaMTX，FFmpeg 補足必要轉碼 | 使用成熟閘道，不在 NestJS 重寫 RTSP／RTP；媒體與業務 API 分開處理 |
| 即時播放 | WebRTC 優先，HLS fallback | 依實際網路、codec 與瀏覽器能力選擇；HLS 使用原生支援或 hls.js，不把 RTSP URL 交給 HTML video |
| 預設錄影 | 保留來源壓縮碼流，fMP4 分段 | 已相容時 stream copy，不解碼再重編，降低 CPU、畫質損失與成本；stream copy 不等於額外壓縮 |
| 相容轉碼 | H.264，必要時音訊 AAC／Opus 分別適配 | 不相容來源才做；共用每來源 rendition，不能每個觀看者各轉一次 |
| 高效率保存 | 可選 HEVC 原碼流／AV1 背景轉碼政策 | 來源已有 HEVC 可直接存；AV1 使用能力探測後的硬體編碼或 FFmpeg SVT-AV1，必須經品質、耗時、節省量與播放相容驗證，不預設 12 路 CPU AV1 即時轉碼 |
| 儲存 | 本機專用有界錄影 volume；可配置 GCS Standard | 本機即可完整運作；GCP 可啟用物件儲存搬移，降低 VM 磁碟壓力；不在 PostgreSQL 存影片 |
| 歷史查詢 | PostgreSQL 時間範圍索引＋片段 manifest | 查詢只讀索引與所需片段，不掃整個磁碟／bucket、不先拼出幾小時大影片 |
| 品質評估 | 碼率、延遲、掉幀、CPU／GPU、VMAF 抽樣與關鍵畫面人工比較 | 評估真實行車／夜間場景；VMAF 是輔助指標，不能替代事件辨識能力 |

MediaMTX 官方提供分段錄影與按時間範圍取回錄影的能力，可用作實作基礎，但本系統的授權、來源版本、容量與歷史索引仍需自行完成。[錄影文件](https://mediamtx.org/docs/features/record)、[回放文件](https://mediamtx.org/docs/features/playback)。

FFmpeg 的 stream copy 避開重編碼；切片與 seek 仍受關鍵幀限制，不能把設定 60 秒誤當每檔精準 60 秒。[FFmpeg](https://www.ffmpeg.org/ffmpeg.html)、[格式與切片](https://www.ffmpeg.org/ffmpeg-formats.html)。

## 四 影像資源管理與即時監控互動

### 影像資源管理首頁

- 預設進來源清單，頂部只保留來源標籤多選（空值＝全部、任一標籤符合）、歷史錄影、錄影儲存狀態與新增來源；來源變動後立即更新，不另設搜尋／重置。
- 表格：名稱、來源標籤、可選載具／位置、已啟用／已停用、線上狀態、儲存錄影設定、實際錄影狀態、遮罩來源摘要、操作。分頁與穩定排序由後端完成，欄位繁多時合理橫向捲動，不能擠成不可讀。
- 每列操作：開關來源、編輯、直接複製、歷史錄影、刪除。清單不建立 live-session、不載入影片或影像縮圖，不提供 hover 播放；歷史入口也不在列內播放。
- enabled 是使用者指令，上線狀態是實際探測結果，錄影狀態又是另一件事。啟用不代表在線；停用表示停止本站接入／錄影，不是對實體攝影機下達電源指令。
- 即使無人觀看且未錄影，啟用來源仍需有有界健康探測。sourceOnDemand 尚未啟動不能直接判成離線；API 提供 checkedAt／stale，過期顯示未知或狀態待更新，不沿用上次綠燈。
- 有錄影的來源用實際接入狀態判斷，其他啟用來源背景有界探測，建議初始 30 秒、有限並發／逾時／退避；不為每次開清單全量重建播放器或長期拉所有主碼流。
- 開關採 optimistic version，顯示套用中／失敗與實際結果。停用時撤銷新播放並中止本站既有串流；錄影收尾，舊歷史保留。來源離線則即時格保留尺寸與錯誤，不把來源自動刪掉。
- 刪除為停用＋soft delete；確認視窗列引用標籤頁數與將停止錄影，保留歷史／稽核。原格子保留 stable tileId、位置與來源已刪除提示，可重新選取，不刪格也不重排版面。刪影片是另有權限的歷史操作。

### 新增與編輯來源對話框

1. 名稱、可建立／選取的來源標籤 chips、協定、主機、port、path／完整 URL、帳密、可選載具／cameraId／位置、啟用開關。
2. 「儲存錄影」預設勾選，可取消；進階提供既有品質／保存設定，無實作的 codec/preset 不假裝可用。來源儲存與是否儲存錄影區分命名。
3. 測試連線、預覽、儲存、取消。只有這個對話框才可做來源預覽，測試用短效 session、不開正式錄影；關閉、取消與切換來源釋放預覽資源。
4. 編輯回填非敏感配置，password 未填保留舊值，明確操作才清除；不回傳解密密碼。儲存成功立即更新清單狀態，網路協調由 worker 套用。
5. 來源標籤是可多選文字分類，trim／去空／去重、每來源最多 10 個、每個 30 字作初值；保留顯示字，規範化比較避免只有全半形／大小寫不同的重複分類。未知標籤可在有設定權限時新增，不必先建分類管理頁。
6. 標籤與名稱變更不建立新的媒體 revision、不重啟串流；真實連線、鏡頭或時間關聯改變才按現有規則建立 revision。

### 一鍵複製來源

- 按複製後直接呼叫後端並在清單目前來源附近顯示新列與成功訊息；不先開對話框、不等使用者按第二次建立。篩選／排序使新列不在當頁時顯示可定位該筆的提示，不能悄悄清空使用者所有條件。
- 新名稱為「原名稱的複製」，名稱上限須先預留後綴長度；不把後綴截掉。允許重複顯示名，sourceId 才是識別，不用名稱當唯一鍵。
- 複製當時連線配置、帳密、來源標籤、啟用、儲存錄影與適用的品質／保存設定，只有名稱和新身份不同。已停用來源複製仍停用；勾選錄影且啟用者複製後會有獨立新錄影需求，依配額處理並明示實際狀態。
- 新 sourceId、新 revisionId 與新 mediaPath；伺服器內安全複製／重新加密 secret，不從瀏覽器要求原密碼。不能共用可變來源 row 或原 revision。
- 不複製舊片段、歷史索引、連線狀態、播放授權、錄影 jobs、lease、建立者與建立時間；新列 actualStatus 從待檢查開始。原始來源改路徑不會改副本，反之亦然。
- 原子檢查來源版本／maxSources／權限與複製，前端防連按；以 requestId 冪等避免網路重試產生兩份。明確再次點複製可再建一份。

### 即時影像監控與版面編輯對話框

- 首頁顯示場站共用的使用者監控標籤頁，支援新增、改名、排序、複製、刪除與編輯版面。來源標籤與這些頁籤互相獨立。
- 新增標籤頁按鈕先開對話框，填名稱、按「加入影像格」。第一格占滿編輯畫布；第二格預設與第一格左右各半。上限 12 格，後端同樣驗證。
- 第三格起先選取要分割的格子，未選取則選面積最大的一格；較寬則左右分割、較高則上下分割，依穩定順序打破平手。新格加入只分割該格，不每加一格重排全部自訂位置。另提供明確的「平均重排」操作，需使用者觸發才重新平均安排。
- 使用者可拖曳格子標題／拖曳把手調整位置，從邊／角拉伸大小；顯示邊界與吸附，最小尺寸、不可越界、不可重疊。已選來源、播放器控制、下拉不作拖曳把手。
- 建議存 0–10000 的正規化整數 x/y/w/h（非螢幕 px），每頁另保存 canvasAspectRatio（初始 16:9，與來源影像比例無關），監看時整體等比例 fit 畫布，避免裝置變化使版面形狀走樣；編輯畫布有固定可用區；前端以畫布尺寸換算，後端檢查所有矩形邊界、最小寬高（初值 500）與正面積相交。相接邊合法，間距用格內 padding 實現。可保留使用者移動後的背景空白，不暗中補位或重排。
- 拖曳／縮放 stop 時才更新草稿；不合法位置回到最後合法矩形並提示。儲存前檢查整份版面，取消不寫後端；API 必須同樣拒絕越界、NaN、負尺寸、重複 tileId、重疊與第 13 格，不能只靠 UI。
- 刪格只刪版面格子，不刪來源、不停止來源錄影；最後一格刪除後草稿可重新加入，但儲存時要求 1–12 格。
- 儲存後版面鎖定，日常監看不能直接拖拉改版。要調整就開「編輯版面」；重整、換標籤、其他有權帳號看同一版面，不能只保存在 localStorage。
- 螢幕變大縮小只等比例／依座標映射整個畫布，不能套舊 gridColumns 自動重排；極窄視窗可以整體縮放／捲動維持最小可操作大小。格子內影片 metadata 不參與 layout 計算。
- 開編輯對話框使用配置示意，不預先啟動 12 路播放器；提交後才正常載入目前標籤需要的來源。

### 格子來源選取與影片填滿

- 建好的格子沒有來源時，直接在格內顯示本站樣式的可搜尋分組下拉，選取來源即保存該格綁定，不跳對話框、不填帳密、不在此建立來源。
- 下拉按來源標籤排序與分組；多標籤來源只呈現一次，以標準化後排序第一個標籤作分組，其他標籤仍顯示 chips；同組依名稱及 ID 穩定排序，無標籤為「未分類」。搜尋匹配名稱／全部標籤／載具／位置，不只分組標題。
- 顯示來源線上／停用狀態：離線但啟用者可選，提示等待來源恢復；停用來源不接受新綁定，既有綁定仍顯示停用。已刪除來源不在新選單，但既有格保留可重新選取。
- 綁定成功立即載入播放器。已綁定格子右上角「設定」才開一個僅重新選來源／清除綁定的簡短對話框，取消無副作用；不開來源連線編輯器、不提供錄影開關。
- 清除綁定恢復格內下拉，layout 完全不變。來源改名／標籤更新反映選單，但不重新建立媒體來源；換來源時釋放舊 session／HLS／WebRTC／計時器，舊請求回應不能蓋新來源。
- 影片必須填滿固定格子的可用影像區，採 `width:100%; height:100%; object-fit:cover`、預設置中裁切，維持影像比例，不拉伸變形、不留 contain 黑邊。直式／橫式／切換解析度都不能改格子尺寸。
- 格子標題列占固定控制高度，播放器父層 `min-width:0; min-height:0; overflow:hidden`；移除 TileView 的 aspect-video 及 LivePlayer 內衝突的 aspect/contain。全螢幕也維持 cover；臨時放大不回寫保存版面。
- 只播放作用中標籤，切換釋放非作用中播放器；預設靜音，一次只開使用者指定的音訊。同 sourceId 多格不增加後端錄影份數。

### 每個監控標籤頁整體全螢幕

這是使用者圖中監控頁籤的整體全螢幕，與每顆鏡頭既有的單格全螢幕不同，兩者都保留但不能混淆。

- 每個標籤頁有可識別的「此標籤頁全螢幕」入口，可放在頁籤更多選單；當前頁籤工具列另有醒目的「標籤頁全螢幕」圖示按鈕，所有有即時檢視權限的人都能用，不需 configure 權限。
- 按下後以使用者手勢呼叫 requestFullscreen()，目標為當前標籤的整個監控容器：包含所有格子、必要的精簡控制與標籤名稱，隱藏應用側欄／頁首／其他管理工具。不只是放大最後點選的那顆鏡頭，也不是把每格各開新頁。
- 全螢幕頂部保留標籤名稱與明確「離開全螢幕」控制，必要狀態短提示即可。Esc／瀏覽器退出／切離頁面都應還原；不要攔截瀏覽器 Esc 造成困住使用者。
- 版面仍使用該頁已保存 normalized rects 與 canvasAspectRatio，依全螢幕可用區重新 fit。尺寸來自 fullscreen root 的 ResizeObserver，不繼續使用進入前 stage 尺寸；清除 minW=640 造成的小螢幕超界並正確約束容器。所有格子同時可見、不可因 full screen 覆蓋或自動排成另一套版面。
- 影片在每格內仍 object-fit:cover，長寬比、直橫片與載入 metadata 不會改格子幾何；整體畫布 fit 可能有畫布外留白，不能以拉伸單格或重排版面消除它。
- 進出不得重建整組播放器／改 key／重取所有 session／中斷音訊；保留目前來源、連線、音量、臨時狀態及播放，不重啟錄影 worker。
- 監控頁 fullscreen 時禁止版面拖曳，版面編輯仍走既有對話框；要修改版面先離開整體全螢幕即可。格內播放控制與來源設定若保留，Popover／Dialog portal 必須掛到 fullscreen root 內，不能 portal 到 body 後被瀏覽器 top layer 蓋掉。
- 若整體 full screen 中按某格全螢幕，使用容器內臨時單格放大／返回整頁，避免兩套 requestFullscreen／exitFullscreen 狀態互相打架；離開單格時回原標籤整體全螢幕。一般非整體模式的單格原生全螢幕行為維持。
- document.fullscreenElement、fullscreenchange／fullscreenerror 是權威狀態，不能只用一個 optimistic boolean 讓按鈕顯示錯誤。requestFullscreen 拒絕時顯示短錯誤，不暗中顯示已全螢幕。
- 瀏覽器不支援原生 API 時可提供同一 DOM 容器的「網頁滿版」備援，並正確標為網頁滿版；不可冒稱已隱藏瀏覽器工具列。測目標瀏覽器與使用者手勢限制，不為此新增全螢幕套件。
- 來源離線、重新連線、token 續期與頁面失效不應卡住退出控制。切換路由／登出時清理 listener／ResizeObserver 並退出本頁自己的全螢幕，不替其他頁任意 exitFullscreen。
- 全螢幕只是當下觀看狀態，不保存到資料庫、不修改版面／格子／錄影設定、不在下次進頁自動觸發（瀏覽器也可能禁止）。

驗收：1／3／12 格各自進出、圖中不等大三格版面、直橫片 cover、Esc、API 拒絕、瀏覽器縮放／視窗 resize、來源離線／重連、權杖續期、無 configure 但有 view、來源對話框與 popover、整體與單格模式來回、離頁／登出；比對播放器 instance／網路請求，確保沒有為全螢幕重啟全部串流。這些都必須用真實瀏覽器驗證，不能只 mock requestFullscreen。

### 逐筆來源與部署連線政策

全域來源預設、路徑樣板與批次套用已移除；來源連線只在逐筆來源建立／編輯時設定。允許主機／CIDR 改由部署端 `VIDEO_ALLOWED_NETWORKS` 統一控制，create／edit／test／live／reconciler 共用同一驗證，不提供一般使用者修改入口。

## 五 錄影以來源為準

- `source.enabled && source.recordingEnabled && 未刪除 && 容量允許` 才是錄影需求；來源未綁任何格也要錄。新來源 recordingEnabled 預設 true，可在來源對話框關閉。
- source.enabled=false：停止本站來源接入／新錄影與新即時播放，保留歷史。recordingEnabled=false：只停止新錄影，來源仍可即時播放並有實際健康狀態。
- 刪格、換格子來源、刪標籤頁、關閉瀏覽器／登出都不能停掉仍啟用且要求儲存的來源錄影。
- 從 VideoConfigService.recordingDemand、VideoReconcilerService、容量狀態、TileView/status、API DTO、測試與稽核全部移除「格子 bool_or 決定錄影」的業務規則。不要前端搬開關但 worker 繼續用舊查詢。
- 同一 sourceId 多格只接入／錄製一份。來源一鍵複製產生新 sourceId，所以副本獨立接入與錄影，不沿用原媒體路徑或歷史；不同 sourceId 即使目前 URL 相同也不能將一方的停用套到另一方。
- desiredRecording 與 actualRecording、失敗／暫停原因分開回應；配額不足保留設定但顯示錄影暫停，不能默默將 checkbox 改 false。
- 暫時預覽不啟正式錄影；關閉來源錄影不刪舊資料。停錄完成當前可恢復片段，依既有 hook／補漏建立索引。
- worker 保留既有鎖／lease、重啟恢復與容量保護；多個 worker 不重複錄製，失敗不能重試無限次。

## 六 錄影儲存與壓縮設計

### 分段與檔案生命週期

- 使用 fMP4，初值以約 60 秒一個持久片段、約 1 秒 part；實際切分受關鍵幀及來源行為影響，索引保存實測起訖。part 與持久片段不是同一層，不把每個 1 秒 part 都變成雲端小物件。
- 錄影根目錄使用獨立掛載，例如 `/var/lib/vtms/video`；由部署設定指定，不能由普通使用者輸入任意 OS 路徑。
- 鍵格式由後端生成，例如 `recordings/{sourceId}/{revisionId}/{YYYY}/{MM}/{DD}/{HH}/{segmentUuid}.mp4`。使用 UUID／UTC，禁止來源名稱或含帳密 URL 當路徑。
- 狀態 `WRITING → READY → UPLOADING → REMOTE_READY`，異常可為 `FAILED`；清理為 `DELETE_PENDING → DELETED`。索引和實體檔案不能假設跨 DB／檔案系統有單一交易。
- 片段完成後 probe／驗證、計算大小與 checksum、冪等 upsert 索引；只有完整可用片段才標 READY。寫入中的尾端可顯示「錄製中」，不得宣稱已完整可回放。
- 程序崩潰後偵測不完整尾段與孤兒檔案，嘗試可行的恢復，否則標缺段並清理；重啟掃描僅限未完成區間／增量，不每次全盤走訪全部錄影。
- 檔案分段完整性與播放驗證都通過後才作雲端搬移／替換，不能只相信完成 webhook；hook 必須驗證來源、冪等且可重試。

### 編碼策略與最新演算法的使用方式

1. `auto` 為預設：probe 來源 codec、解析度、fps、碼率、GOP；相容時錄原碼流。利用攝影機已有的主／子碼流，主碼流錄影、低碼率子碼流多格預覽，避免伺服器無謂重編。
2. H.264 作相容播放輸出；來源 H.265／AV1 可存原碼流，瀏覽器能力不足時產生共用 H.264 proxy。容器能裝某 codec 不代表所有瀏覽器都能解碼，必須實測／能力探測。[hls.js](https://github.com/video-dev/hls.js)。
3. 需要轉碼時，提供「原始／平衡／節省空間」三個可理解預設；進階欄位才顯示 codec、fps、最大碼率、解析度、品質與 GOP。平衡初值可用 1080p、15 fps、約 2–4 Mbps 上限測試，不能當成所有場景足夠的保證；原始策略不降畫質，使用者選更省模式時明示變更。
4. 自行轉碼的相容播放 proxy 目標關鍵幀約 1–2 秒；錄原碼流時不能憑空強制新關鍵幀。音訊必要時分別產生適合 HLS／WebRTC 的 rendition，不能只改 MIME 假裝相容。
5. 「高效率歷史壓縮」實作為可選背景任務，預設關閉：對已完成片段測試 HEVC／AV1；AV1 用實際可用的硬體 encoder，無硬體時使用有資源上限的 SVT-AV1。不同 encoder 的 CRF／CQ 不可直接視為相同品質。[FFmpeg codecs](https://www.ffmpeg.org/ffmpeg-codecs.html)、[AV1](https://aomedia.org/specifications/av1/)、[NVIDIA 編碼能力](https://developer.nvidia.com/video-codec-sdk)。
6. 壓縮候選須與原檔比較，建議初始通過門檻：容量至少減少 15%、同尺寸對齊後 VMAF ≥90、duration／時間映射／解碼驗證通過；門檻可配置且需以本場域人工檢查校準。門檻是本案初值，不是監控取證的通用標準。[VMAF](https://github.com/Netflix/vmaf)。
7. 背景任務初始並發 1、低優先權，超時與 CPU／GPU／磁碟預算有上限，預留重編所需額外空間。即時掉幀、磁碟壓力、排程超時時暫停背景壓縮；失敗保留原檔，不重試無限次。
8. 保留原檔或以壓縮版替換是明確政策，預設保留原始版並顯示雙份所占空間；若要節省容量，管理者可以啟用「驗證後以壓縮版替換」，需清楚說明有損重編與受保護片段排除。替換以新 rendition、完整驗證、原子切換索引及延後回收完成，不能原地覆寫播放中的檔案。
9. 壓縮不能把既有高壓縮影像再 zip／gzip 當作主要省空間方法，也不先做自訂神經壓縮、動態插幀、影像美化或假補幀。錄影與歷史時間軸保留真實內容；不做未要求的移動偵測事件錄影，避免漏掉靜態但重要的場景。

### GCP 儲存

- 實作 local 與 GCS 兩個 storage adapter，未設定 bucket 時本機完整可用。GCS 可在有管理權限的儲存設定配置 bucket／prefix；憑證使用部署服務身分／工作負載身分，不能要求把 service-account 私鑰貼在一般格子。
- 預設 GCS Standard 作近期、短保存且隨時查閱的錄影儲存選項。Nearline／Coldline／Archive 有最低儲存期限等成本條件，不因名稱「Archive」就自動套用短期監控。[GCS 儲存級別成本](https://cloud.google.com/storage/pricing)。
- 已完成片段以持久化任務上傳，驗證 checksum／物件 generation 與索引後，才依本機快取政策回收本機副本；雲端失敗要保留可用本機資料並受磁碟保護控制，不無限累積上傳佇列。
- 避免使用會傳播刪除的雙向／鏡像同步作唯一搬移機制。物件 key 不覆寫，重試冪等；不要每個 hook 全量 rclone sync 整個資料夾。
- GCS lifecycle 作最終保護，業務 retention worker 管理索引與應用清理。soft delete 及 object versioning 會影響刪除後空間／費用，設定頁區分「應用已移除」與「雲端仍保留」。顯示目前 bucket 保護政策，專用循環錄影 bucket 可由管理者選擇 soft delete 政策；不擅自改其他 bucket。[Lifecycle](https://docs.cloud.google.com/storage/docs/lifecycle)、[Soft delete](https://docs.cloud.google.com/storage/docs/soft-delete)。

## 七 容量保護與自動／手動刪除

錄影預設打勾，必須同時交付可用的容量治理，不能只寫「請部署時自行注意」。

- 全域儲存設定提供：儲存位置類型、保留天數、影片最大用量、本機快取上限、最低剩餘容量、目前／預估用量、錄影中來源數、預估可存天數。接既有資料管理頁作細部管理，監控頁僅顯示短狀態與設定入口。
- 初始保存 7 天；本機首次自動預算取「50 GiB」與「當時可用容量的 25%」較小值，最低保留空間取 5 GiB 與磁碟總量 10% 較大值。這是可調整的起始保護值；若可用容量不足最低保留空間加必要寫入預算，來源仍可保存但錄影顯示空間不足，不能假裝已錄製或要求無限等待工程介接。
- 超過錄影預算 85% 開始按最舊完成片段回收至 75%；達 95% 或最低剩餘空間失守時先嘗試緊急回收，無法安全回收則暫停新錄影、持續即時監看並提示。計算可分配空間需扣除檔案系統其他用量，不能只看錄影資料夾大小。
- 保留天數與容量上限先觸及者優先；容量可能讓實際保存短於 7 天，要在 UI 顯示預估與實際可用最早時間。未設定來源碼率時先 probe／實測估計，不能顯示假精準值。
- 估算公式：每日 GB ≈ 各來源平均 Mbps 總和 ×10.8；例如 12 路各 3 Mbps 約 388.8 GB／日，7 日約 2.72 TB，另加音訊、封裝、快取及空間餘裕。此為十進位估算，不是保證壓縮後容量。
- 被使用者明確保護的片段不自動清除，但同樣計入配額；全部受保護且空間不足時暫停新錄影，不清除保護資料。播放／下載中的短效 lease 防止當前檔案被中途刪除，lease 有 TTL，不能永久鎖住全庫。
- 手動刪除按來源／時間範圍預覽筆數、容量、保護與播放中項目，確認後產生有界任務。刪錄影權限與來源設定權限分開，寫操作稽核。
- `DELETE_PENDING` 後撤銷新播放授權，刪本機／雲端各副本與 proxy／縮圖，成功後標 DELETED；重試、部分失敗與索引校正要可觀測。設定資料、事件、軌跡、日誌不能跟著影片 cascade 刪除。
- worker 用現有工作排程與 DB 鎖／佇列能力，避免兩套互不知情的刪除程序；MediaMTX 自動刪除由同一政策產生或停用，不能一邊保護片段，另一邊按固定天數偷偷刪掉。

## 八 影像資源管理內的歷史錄影

來源清單每列有「歷史錄影」按鈕，點入資源管理的全寬歷史子畫面，麵包屑「影像資源管理 › 來源名稱 › 歷史錄影」，有返回清單按鈕並保留原篩選／排序／頁碼。不用小彈窗塞長時間軸，也不新增第三個側欄頁。清單頁仍無預覽，這個明確進入的歷史子畫面可以播放歷史影片。

清單工具列另有「歷史錄影」入口，可查多來源及已刪除但仍有歷史的來源。只有歷史權限者可由資源管理進入歷史模式，不因此取得來源連線與秘密。

- 條件：來源標籤、來源（可多選）、載具／位置、起訖時間；監控標籤頁可作輔助來源集合篩選，不能與來源標籤混名。歷史可單獨查停用／已刪除但仍有錄影的來源；來源現在的分類只是篩選條件，車輛／時間關聯以歷史 revision 為準。
- 預設最近一小時、單來源播放；可切多來源同步模式，上限 12 格但不自動播放所有查詢結果。沒有選車也能查固定場域鏡頭。
- 日曆標示有錄影日期，時間軸顯示有資料／缺段／錄影中／已到期／受保護等真實狀態；時間完整顯示日期、秒與網站時區。
- 先讀 metadata／availability，再按需要載入媒體；拖曳查找採取消舊請求、debounce 與短範圍預取，不為每次 mousemove 產生一次轉碼工作。
- 播放／暫停、定位、倍速、逐幀（能力可用時）、全螢幕。逐幀不能以任意固定毫秒冒充真實下一幀；來源未提供時明示能力限制。
- 多畫面共用絕對時間游標，建議初值：誤差 <250ms 不干預、250–1000ms 輕微調整播放速度、>1000ms seek；這是待測初值，對 pause、seek、緩衝與缺段另處理。某來源缺段顯示空白狀態，不能暫停其他全部來源或拿上一幀假裝即時畫面。
- 片段以 UTC 絕對起點加媒體相對時間對齊；記錄 timestampBasis（來源／中心接收）、時間偏移、來源時鐘可信度。攝影機未同步時標註精度限制，不能宣稱毫秒同步。MediaMTX 預設可能使用中心系統時間，必須顯式決定是否信任來源絕對時間。[時間映射](https://mediamtx.org/docs/features/absolute-timestamps)。
- 缺段可「跳至下一段」，由使用者決定；斷線、關閉儲存、磁碟保護、到期刪除原因應可區別。
- 下載選定來源與區間：快速模式依關鍵幀取範圍並說明實際起訖；精準裁切才重編必要邊界，採有界非同步 job，避免 HTTP request 阻塞或整段影片重編。下載權限、到期與暫存清理要完整。
- 事件詳情可帶 eventId、來源／載具及事件前後 30 秒導到資源管理的歷史子畫面；EventReplayDialog 也用同一 timeline/playback service。歷史來源和載具關聯用當時版本／時間有效範圍，不拿現在標籤位置推定當時是哪台車。

## 九 歷史索引與播放路徑

1. 片段索引查重疊：`source_id = :source AND start_at < :to AND end_at > :from`，加來源／開始時間索引；量大且 EXPLAIN 證明必要時補範圍 GiST，先不另建影片搜尋引擎。
2. 查詢按實際片段邊界回傳 availability 與 gap，使用半開區間；跨午夜／來源重啟／codec 變更均應正確，不靠檔名字串解析日期作唯一事實。
3. 播放 session 保存 sourceId、revision、允許時間窗、使用者與到期，取得受保護的 manifest／媒體 URL。媒體資料走 Nginx／gateway／物件儲存，NestJS 負責授權與索引，不能讓 Node 將全部影片讀入 Buffer。
4. 起始實作可用 MediaMTX 的 `/list`、`/get` 做本機區間 adapter，或生成 HLS VOD manifest。雲端／多版本統一透過本系統索引與 manifest，不假設 MediaMTX 能直接掃 GCS。不同 codec／初始化參數之間使用正確 discontinuity／新 init，必要時建立相容 proxy。
5. 本機受控檔案支援 Range／206、Content-Type、取消請求與 seek。GCS 原片可短效簽名，但完整播放流程要處理 URL 到期；HLS manifest 及其所有子資源均需授權，不能只保護首頁 m3u8。
6. 對不支援的原碼流按來源版本＋時間窗＋preset 建 proxy cache，single-flight 合併相同任務；有 TTL、LRU、容量配額，與錄影預算一起計算。查詢不因每位使用者而複製相同代理影片。
7. 時間軸縮圖按需、低頻產生並共用快取，不對每格每秒存全尺寸 JPEG；保留 HLS 緩衝與錄影快取界線，取消錄影時不能將播放器快取永久留下。

## 十 資料庫 遷移與相容性

沿用既有 PostgreSQL／TypeORM、video_* 表、分段索引、儲存與 worker，不重建已完成平台。以下欄位按實際 schema 補齊，不新增同義表：

| 實體 | 本次變更 |
| --- | --- |
| video_sources | 增加 tags（有界 JSONB 字串陣列即可）、recording_enabled；保留 enabled、sourceId、revision、version、actualStatus、soft delete |
| video_monitor_tabs | layout_schema_version、canvas_aspect_ratio、固定正規化畫布範圍、tile_count 與 version；新建初值 1 格，數量 1–12 |
| video_monitor_tiles | stable tileId、tabId、position、可空 sourceId、x/y/w/h、version；唯一位置、正規化邊界與尺寸驗證；不再作錄影真相來源 |
| video_source_revisions | 複製來源要建新的 revision/mediaPath，來源 tags/name/錄影開關則不改 revision |
| 現有 recordings／objects／jobs／storage policy | 保留既有檔案、source/revision 索引與歷史，不改來源標籤或版面就搬影片 |

遷移要求：

1. 新來源 recording_enabled default true；既有來源按舊有效格子的 bool_or(recording_requested AND enabled) 回填，無有效格子則 false。這是避免升級後突然為未使用來源開錄，後續使用者可在來源對話框主動勾選。enabled=false 仍保留算出的保存意圖，實際錄影受 enabled 控制。說明此遷移規則，不一刀切將舊來源全部設 true。
2. 既有 tag 資料有則保留，沒有設 []。規範化標籤去重；需要 GIN 索引時依實際篩選 EXPLAIN 決定，不建全新分類平台。
3. 既有每頁 n 格依舊 gridColumns 的基準寬版欄數，穩定回填 normalized x/y/w/h；新建 1 格滿版、2 格左右均分。保留 sourceId、來源 secret、tileId、頁序與頁名，不把目前 nth index 當作永久身份。
4. 現有 saveTiles 可能依 position 重建 UUID，須改成依 stable tileId 差異更新；布局保存不能讓播放器／引用身份全部重建。未授權 tab 的 tileId、重複 ID／sourceId 錯綁要拒絕。
5. 保存名稱、layout、增刪 tiles 在一筆交易中完成，用 tab.expectedVersion 防止另一人覆蓋；綁定獨立保存時同樣鎖定 tab／tile，版面與選來源的寫入互不吞掉。不可在鎖等待時做慢速媒體網路呼叫。
6. 應用與 worker 改讀 source.recording_enabled 後，舊 tile recording_requested 先保留 deprecated 但不再影響行為，舊寫入端不能再更改錄影。若收到舊錄影參數回清楚的版本／契約錯誤，不靜默接受假成功。確認無呼叫者才以後續 migration 刪欄位。
7. 舊 video-history route 帶條件時轉歷史子畫面；無條件則到資源管理首頁。保留舊 source/revision ID 與媒體檔案，刪來源不 cascade 刪片段。
8. 新 migration 加到 deploy/migrations/order.txt，測空 DB、既有 DB、可重跑 ledger 與已保存版面。部署時先更新 schema、停止舊版 worker 再啟新版，禁止兩種錄影需求算法並行。禁止 synchronize 重建表或為了通過升級清空資料。

稽核增加來源複製、來源啟停／儲存切換、版面儲存、綁定來源，記 actor 與 source/tab/tileId，秘密脫敏；不記每個拖曳 mousemove，也不每次輪詢寫稽核。

## 十一 API 契約與前端整合

沿用 `/syncdrive-api/video`、session／CSRF／Guard、現有媒體播放授權；同步 DTO、Swagger、前端型別、既有模擬器／事件呼叫者與整合測試。新增必要端點即可，不複製一套服務：

| API | 行為 |
| --- | --- |
| GET `/sources` | 分頁＋tags（OR），穩定排序；清單摘要含 checkedAt/stale、recordingEnabled／actualRecording／usage，無 secret、無播放器 |
| GET `/source-tags` | 有權限且有界的來源標籤選項／計數，供清單與分組來源選單 |
| POST `/sources`；PATCH `/sources/:id` | 建立／修改名稱、tags、connection、enabled、recordingEnabled 等；含 expectedVersion，建立預設錄影 true |
| PATCH `/sources/:id/enabled` | 清單直接啟停，expectedVersion＋enabled，回 desired 與 actual 狀態；可共用 updateSource 實作 |
| POST `/sources/:id/duplicate` | 原子複製，expectedVersion／requestId，回 201＋新 source 摘要；舊來源 version 不更改 |
| DELETE `/sources/:id` | 引用影響確認、soft delete，保留歷史與格子尺寸，不能物理 cascade 刪錄影 |
| POST/GET/DELETE `/source-tests` 相關路由 | 僅來源新增／編輯對話框用的短效真實預覽，不錄影 |
| GET `/source-options` | 可搜尋／分頁／標籤分組的安全來源摘要，給即時監控；不含 connection 帳密，只需 monitor view 與綁定權限組合 |
| GET/POST `/tabs`；PATCH/DELETE `/tabs/:id` | 名稱與持久化 layout 管理；建立帶 1–12 個 stable tile 草稿、沒有來源也可存 |
| PUT `/tabs/:id/layout` | expectedVersion＋完整 normalized rects；同交易增刪更新 tiles 與校驗整體邊界／重疊 |
| PATCH `/tabs/:id/tiles/:tileId/source` | expectedVersion＋sourceId 或 null，僅換此格來源，不改 layout 或來源錄影 |
| 既有 tabs reorder/duplicate | 保留能力；複製版面需新 tab/tileId，引用同一 sourceId、不複製來源與錄影 |
| 既有 live-sessions、recordings/calendar/availability、playback-sessions、manifest、exports、jobs | 後端播放及歷史能力沿用，前端入口換到兩頁新結構 |
| 既有 defaults、storage-policy/status、capabilities | 移到資源管理進階入口，不放在每格設定對話框 |

矩形資料至少為 `{tileId, x, y, w, h, position}`，canvas 使用固定 10000×10000 邏輯座標與另存的 canvasAspectRatio；不是把實際播放畫布強迫成正方形。與 sourceId 綁定的輸入分開，避免編版面時意外還原另一人剛選的來源。server 不接受非數值、越界／重疊、跨 tab ID、已刪／停用來源的新綁定。

啟停與複製使用預期版本與冪等鍵；連線套用非同步時回 settingAccepted／actualStatus，不把 HTTP 200 當成在線。清單狀態用現有授權 Socket 失效／有界輪詢更新，不把所有來源 live-sessions 都建起來。

## 十二 權限與必要邊界

- 保留既有 permission code 相容：events.video.view 管即時監看、events.video.configure 管來源／監控版面設定、events.video.recording-manage 管來源錄影政策與全域儲存、events.video-history.view/export/delete 管歷史。UI 顯示名稱更新為兩頁新名稱，不因改頁名擅自重設角色。
- 資源管理入口對具有 configure、recording-manage 或任何 history 權限者可見；頁內僅開放其動作與資料。只有 history 的人可由安全來源摘要進歷史，不可讀／改攝影機連線；只有 live view 的人可在即時頁讀安全選項，但不能改來源／版面。
- 新增／複製來源或編輯來源時，若 payload 要變更儲存政策需檢查 recording-manage；新增預設 true／複製 true 也不能繞過。缺權限採明確拒絕整個所請操作並提示，不能偷偷把錄影改成 false 產生不一致副本。
- 有頁面 view 沒動作權限保留按鈕、點擊沿用 auth.require 提示；純 view 不可操作版面或持久換來源。有 configure 則可版面／綁定，不因此取得歷史匯出或刪影片權。
- 原角色曾有 live+history 的相容路徑須有回歸測試；controller 方法級權限與類別級權限要核對實際 Guard 合併語意，避免 history-only 被外層 live view 錯誤擋住。
- Secret 只寫不讀，來源複製只在後端安全複製。一般清單、選單、log、Socket、CSV 不含密碼或長效 token。
- 延用 LAN allowlist、metadata／loopback 阻擋、DNS／redirect 防護及受控 argv，不為來源複製或預覽開任意 URL 代理；HLS 子資源同樣驗證。
- 短效媒體 token 綁 session/source/動作/時間窗；登出、撤權、來源停用／刪除後撤銷新資源並關閉可撤銷連線。MediaMTX Control API/hook 不公開匿名存取。
- 不把工程或資安長清單放在產品頁面，限制落實後端，錯誤精準、短而可操作。

## 十三 部署與性能要求

- Docker compose 新增固定版本／digest 的 MediaMTX 與媒體 worker，錄影、proxy cache、配置有清楚 volume 與資源限額。NestJS 主進程不承擔轉碼，也不能讓 worker 跑滿 CPU 擠掉 MQTT／車控。
- 依已驗證版本的 Control API／OpenAPI 產生配置，不照網路文章猜 API。此次查核的官方 Control API 頁面標示 v1.21.2，實作時核對並固定選定版本，不能用浮動 latest。[Control API](https://mediamtx.org/docs/references/control-api)。
- WebRTC 需完成 GCP／NAT 實際 ICE 路徑；必要時用短效 TURN，無法連通則自動 HLS fallback。HTTPS 頁面不得混入不安全播放 URL。[WebRTC 網路設定](https://mediamtx.org/docs/features/webrtc-specific-features)。
- 來源 desired config 存 DB、worker reconcile 到媒體服務；重啟重建狀態、失敗退避與抖動、有限重試，不能每個 poll 一直重開 ffmpeg。
- 目前標籤最多 12 路實際解碼，背景標籤不占 12×頁數的解碼；跨使用者共用接入、錄影與 rendition，畫面品質可依格子尺寸降 preview profile，不降低錄影品質。
- 自動模式至少達官方 10 Hz 的實際來源要求，驗收 11 與 12 路；來源本身低於 10 fps 應顯示來源限制，不補幀冒充達標。瀏覽器硬體不足的情況顯示負載狀態並提供較低預覽品質，不能靜默少播某一格。
- 本機開始播放／歷史 seek 初值目標 ≤3 秒，影像／軌跡對齊初值目標 ≤500ms，均以實際可用時間戳與 LAN／指定部署環境驗證，非對所有來源的保證。記錄 p50/p95、CPU/GPU、網路與磁碟，不只記首頁 HTTP 200。
- 新 migration 納入 `deploy/migrations/order.txt` 並測空 DB／既有 DB 升級。配置、schema、服務啟動順序及健康檢查交付，不自動操作正式 GCP、開放付費資源或覆寫 production data。

## 十四 實作順序與驗收清單

依序完成：來源 tags／recordingEnabled 與遷移 → 資源清單／來源對話框／直接複製 → worker 來源錄影切換 → normalized layout API／編輯對話框 → 格內分組選單／設定換源／cover 播放 → 歷史入口與深連結 → 權限／模擬器對應／整合驗證。這次重組以現有串流、錄影與儲存能力為基礎，不把尚未完成的 codec/proxy 功能假裝已完成，也不為版面重構重做平台。

必測案例：

1. 側欄只顯示影像資源管理與即時影像監控，歷史只由資源管理進入；舊 video-history/事件/模擬器連結保留來源與時間，返回保留清單條件。
2. 資源清單全程沒有播放器／影像縮圖及隱藏 live-session；filter、分頁、標籤、啟停、實際上線／stale／停用狀態正確。無錄影且無觀看來源仍有有界真實探測。
3. 新增／編輯來源可設分類 tags、儲存勾選、預覽與取消；預覽不錄影、密碼不回傳、關閉釋放 session。只改名稱／tags 不重啟媒體。
4. 一鍵直接複製出「原名的複製」，連線／秘密／tags／enabled／recordingEnabled 一致，sourceId/revision/mediaPath 獨立，actual 狀態重置，沒有複製原歷史。重試冪等、連按與名稱長度、上限、來源版本衝突、無錄影權限案例都要測。
5. 未綁格子的啟用且儲存來源會實際錄影；刪格、換綁定、刪監控頁、登出都不停止它。來源取消儲存仍可即時播放；停用來源停止本站接入及新錄影但歷史可查。
6. 新增監控頁先開對話框，1 格滿版、2 格左右均分；3–12 格按規則分割，既有其他格不被重排，第 13 格前後端拒絕。刪到零時不可保存，取消不改資料。
7. 拖拉、四邊／角縮放、邊界、吸附、最小尺寸、越界、重疊、NaN／負值／跨 tab tileId、並發版面與換來源，均驗前後端；sourceId/tileId 不因拖曳全部重建。
8. 自訂不等大格子保存後重整／換標籤／換視窗／換帳號呈現一致；監看模式鎖版，無法誤拖；放大／全螢幕與切換影片尺寸不改持久版面。
9. 空格直接分組下拉而非彈窗；多 tags 去重分組、未分類、搜尋、來源離線／停用／刪除均正確。已綁格右上設定才彈重新選來源視窗，清除只清綁定。
10. 直式、橫式、超寬影片在同一格都 cover 滿格、置中裁切且不變形／不改格子尺寸；測播放器內部、HLS／WebRTC fallback、全螢幕與錯誤狀態不造成 layout shift。
11. 來源刪除後格子保留幾何與可重選提示，舊錄影可從資源管理歷史模式查到；事件回放仍以歷史 revision 車輛關聯對齊。
12. 舊 DB 升級回填來源錄影意圖／無格來源 false、既有版面位置、來源 tags、secret、source/revision/tileId、錄影索引保留。舊 worker 不和新 worker 混跑，新 schema/ledger 可重跑。
13. live-only／configure／recording-manage／history-only／export/delete 角色實際 API／UI／Socket／媒體授權均驗；history-only 不讀連線秘密，來源複製不能繞過錄影權限。
14. 錄影分段、quota 高低水位、保護／lease、GCS、壓縮、Range/206、缺段、事件前後 30 秒、多來源歷史同步與原有模擬器 RTSP 管線回歸，不能因改入口丟失既有能力。

用有限測試 fixtures／隔離 DB 與錄影目錄驗證，測後清理自有資料。不跑無限模擬器、不調低正式容量保護。執行前後端 build、相關單元／API／媒體整合測試，並以真實瀏覽器驗證拖拉縮放、分組下拉、cover 與歷史入口；命令、環境、結果須實錄，未執行不能寫通過。

最終交付：前後端與所有呼叫者修改、migration/order、角色與稽核對照、資料升級規則、使用者操作說明、回歸測試與尚未實機驗證的限制。相關功能依同目錄《事件管理與日誌管理實作指示》第十五節的 Git 要求 commit 到 main，回報實際 SHA；不自動 push 或部署。只更新本檔作影像唯一製作指示，不產生 v2／補丁版指示；其他文件只保留指向本檔的摘要／相容性更新，歷史交付紀錄不回寫成新功能已完成。
