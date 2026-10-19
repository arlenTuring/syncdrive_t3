# 影像監控標籤頁與歷史錄影實作指示

本次交付給 Claude Code 的工作是實作功能與測試。本文件取代前一份《事件管理與日誌管理實作指示》中所有影像監控、來源設定、錄影與歷史影像的衝突內容；事件及四類日誌的其餘要求保留。請讀取適用的 AGENTS.md、目前程式與本文件後直接完成實作。

## 一 本次確定的產品行為

1. 移除影像監控頁目前的大面積黃色介接說明、缺少契約清單、「本系統預設不錄影」及「11 台上限、第 12 格保留」。這些不應成為一般使用者的操作介面。
2. 使用者可以建立、命名、排序、編輯、複製及刪除監控標籤頁。每頁自行選擇 1–12 格，每格都能使用，第 12 格沒有保留限制。頁數不限制為一頁，但後端仍須有可配置的資源上限及分頁，避免無界建立。
3. 每格可以設定影像名稱、影像來源、可選的載具／位置關聯，測試連線並預覽；也能從既有來源選擇，不強制一車一鏡頭。
4. 提供全站來源預設、標籤頁批次套用、個別格子覆寫。使用者可先用全域主機與路徑樣板產生來源，再逐格修改最終路徑。
5. 新增有效影像來源時，「儲存錄影」預設勾選，可取消；儲存有效設定後由伺服器持續錄影，與瀏覽器是否開啟、是否觀看該標籤頁無關。
6. 「測試／預覽」是暫時操作，不寫正式錄影；來源儲存成功後才依勾選狀態啟動。僅建立空格、未設定來源時不啟動錄影。
7. 「歷史影像查詢」獨立成側欄頁面，提供時間查詢、可用片段時間軸、播放、拖曳定位、倍速、多來源同步及有權限的片段下載。即時監控頁移除目前只有文字結果的歷史查詢區。
8. 整體深色風格、頁首、側欄、字型、按鈕、分頁、提示、下拉與日期時間控制沿用目前網站。使用者只需看到能設定、能播放、能儲存的介面；編碼器、閘道、索引等實作名詞留在工程文件與進階設定。

## 二 現有程式修改入口

先讀取下列實作，沿用已有權限、稽核、錯誤與 UI 共用能力：

- `frontend/src/features/event-management/VideoMonitorPage.tsx`：目前只有版型與空格，重做為標籤頁管理與真實播放器。
- `frontend/src/features/event-management/EventReplayDialog.tsx`：目前影像側尚未真正播放，必須串接本次歷史播放服務。
- `frontend/src/features/event-management/api.ts`：替換 status/missing 與 unknown[] 型別；將影像 API 分離為清楚的型別化模組。
- `backend/src/event-log/video.service.ts`：目前固定使用 NotConfiguredVideoProvider，替換為實際來源設定、媒體服務及歷史索引。移除 VIDEO_MISSING_CONTRACT 作為一般頁面內容的設計。
- `backend/src/event-log/events.controller.ts`：VideoController 現有 `/video/sources`、`/video/streams/:id`、`/video/recordings`；升級契約時同步更新全部呼叫者與測試。
- `frontend/src/features/schedule-management/types.ts`、`index.tsx`、側欄及語系：新增 `video-history` 頁面與權限，保留 `video-monitor`。
- `backend/src/access-control/access.constants.ts`：保留 `events.video.view` 的現有角色相容性，新增設定、錄影政策、歷史播放與下載所需權限。
- `deploy/docker-compose.prod.yml`、`deploy/nginx.conf`、`deploy/images.lock`、`deploy/migrations/order.txt`、`deploy/migrate.sh`：加入可部署的媒體服務、磁碟掛載、受保護串流代理及 migration。

不可只把黃色說明藏起來，底下仍保留空 provider；也不可用前端 localStorage 當正式設定或錄影索引。現有事件、日誌與地圖功能要維持相容。

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

## 四 監控標籤頁與互動細節

### 標籤列與版型

- 頁面上方是監控標籤列，支援新增、改名、拖曳排序與更多選單；當前頁名稱、格數及設定儲存狀態可見。標籤過多時橫向捲動，不壓縮成不可點選。
- 預設提供「監控總覽」標籤，初始 4 格；只有空白設定，不植入假攝影機。有既有設定時遷移保留。
- 快捷版型 1、4、9、12 格，另可輸入 1–12 的任意整數。依格數適配欄數：1 格一欄、2–4 格兩欄、5–9 格三欄、10–12 格四欄；小視窗依現站斷點調整，格子維持合理長寬比。
- 減少格數時預覽哪些格子會從該頁移除；不刪原始來源、不刪錄影。若會取消某來源最後一個錄影需求，提示受影響來源與將停止的新錄影，確認後才套用。
- 標籤頁設定為場站共用資源，有管理權限者修改、其他有檢視權限者可看；當前標籤、音量、暫時放大可作個人偏好，不將帳號私有與全站配置混成同一份。
- 切換標籤釋放非作用中播放器，但後端錄影繼續。跨標籤不預先播放全部影像。預設靜音，一次僅啟用使用者指定的音訊。

### 每個格子的設定與預覽

格子頂部：名稱、來源摘要、連線狀態、錄影狀態、設定、放大／全螢幕。狀態以短文字及小徽章表達，例如「未設定」「連線中」「播放中」「錄影中」「僅即時」「錄影暫停：空間不足」。空格顯示「設定影像來源」按鈕。

設定對話框包含：

1. 影像名稱、選用現有來源／建立新來源。
2. 協定、主機、連接埠、路徑、帳號／密碼；提供完整 URL 輸入模式，由後端解析並脫敏，不把含密碼 URL 放到一般頁面。
3. 可選載具、攝影機識別、位置／視角，來源可不屬於任何車輛。
4. 「儲存錄影」checkbox 預設勾選，與「儲存設定」按鈕區別命名；可選保存策略及錄影品質預設。
5. 「測試連線」「預覽」「儲存設定」「取消」。測試回報可理解的錯誤，預覽顯示真正畫面與目前取得的解析度、fps／codec；沒有數據則顯示未知。
6. 預覽使用短效 preview session、逾時與並發上限，關閉即清理；不開始正式錄影，不留下永久測試來源。測試不能讓其他格子正在播放的正式來源斷線。

換來源時區分「更換此格綁定」與「修改共用來源」。前者不影響其他格；後者顯示所有受影響標籤／格子並確認。來源更新採版本控制，後端拒絕舊版本覆蓋較新設定。

### 全域設定與批次套用

- 「全域來源預設」提供協定、主機、port、共同路徑前綴、路徑樣板、憑證與新來源錄影預設。主畫面只放一個入口，不常駐工程說明。
- 支援明確白名單變數，例如 `{vehicleCode}`、`{cameraId}`、`{index}`，不支援 JS、shell 或任意 expression。每一格可以指定變數值，再修改最終路徑。
- 範例：全域 `rtsp://10.20.0.10:554`，樣板 `/cameras/{cameraId}/main`；第 1 格 cameraId=`front01`，得到 `/cameras/front01/main`，第 2 格可覆寫為 `/special/rear`。憑證另存，預覽 URL 不含密碼。
- 套用範圍可選目前標籤、勾選格子、全部標籤；預設只填空白／未覆寫欄位。提供「覆蓋已自訂欄位」選項與變更前後預覽，避免一鍵破壞所有來源。
- 「儲存全域預設」只影響將來新建；「套用到既有格子」才修改現有設定。採快照套用，不暗中即時繼承全域值，避免改一次主機讓所有串流突然換來源。
- 批次更新先驗證全部輸入，再以交易保存 desired config；來源實際連線由 worker 套用，每格顯示待套用／已套用／失敗可重試。資料庫交易不能橫跨慢速網路連線。
- 共享同來源時，UI 應提示這是同一來源，不重複建立錄影。修改單格路徑造成真正不同來源時，建立新來源／來源版本，不冒用另一台鏡頭的歷史。

## 五 錄影需求與來源共用規則

資料模型分開「標籤／格子」和「攝影機來源」。同一個 sourceId 被多個格子引用，只接入一份主碼流、錄製一份歷史。必要的低解析子碼流可另外接入，但全站共用。

- 格子保存 `recordingRequested`，新綁定有效來源時預設 true。來源的有效錄影需求為「至少一個啟用格子要求錄影」，並受停用來源與全域容量保護控制。
- 某格取消勾選不刪過去錄影；若其他格仍勾選，來源仍錄影，該格顯示「此格不要求錄影；來源仍由其他格儲存」，避免承諾未儲存卻仍有共享紀錄。
- 若全部格子取消，關閉／刪除最後一個請求，則完成當前可恢復片段後停止新錄影，保留歷史至到期。刪除標籤、來源停用也遵循此規則。
- 不把「預設勾選」做成只勾 UI，後端其實永遠 disabled。回應必須分 desiredRecording 與 actualRecording，附容量不足、離線、轉碼失敗等原因。
- 關閉網站／登出不停止錄影；worker 重啟後依已保存需求恢復，並以 lease／鎖確保單一來源不被兩個 worker 重複錄製。
- 允許只即時不保存：沒有其他需求時不產生持久錄影片段；必要播放器暫存應有短 TTL，不可悄悄保留成歷史。

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

## 八 獨立歷史影像查詢頁

側欄新增「歷史影像查詢」，與「影像監控管理」平行，不藏在監控頁底部。

- 條件：標籤頁、來源（可多選）、載具／位置、起訖時間。標籤篩選使用目前來源集合，歷史也可單獨選停用／已移除但仍有錄影的來源；不能因格子改綁就查不到舊影片。
- 預設最近一小時、單來源播放；可切多來源同步模式，上限 12 格但不自動播放所有查詢結果。沒有選車也能查固定場域鏡頭。
- 日曆標示有錄影日期，時間軸顯示有資料／缺段／錄影中／已到期／受保護等真實狀態；時間完整顯示日期、秒與網站時區。
- 先讀 metadata／availability，再按需要載入媒體；拖曳查找採取消舊請求、debounce 與短範圍預取，不為每次 mousemove 產生一次轉碼工作。
- 播放／暫停、定位、倍速、逐幀（能力可用時）、全螢幕。逐幀不能以任意固定毫秒冒充真實下一幀；來源未提供時明示能力限制。
- 多畫面共用絕對時間游標，建議初值：誤差 <250ms 不干預、250–1000ms 輕微調整播放速度、>1000ms seek；這是待測初值，對 pause、seek、緩衝與缺段另處理。某來源缺段顯示空白狀態，不能暫停其他全部來源或拿上一幀假裝即時畫面。
- 片段以 UTC 絕對起點加媒體相對時間對齊；記錄 timestampBasis（來源／中心接收）、時間偏移、來源時鐘可信度。攝影機未同步時標註精度限制，不能宣稱毫秒同步。MediaMTX 預設可能使用中心系統時間，必須顯式決定是否信任來源絕對時間。[時間映射](https://mediamtx.org/docs/features/absolute-timestamps)。
- 缺段可「跳至下一段」，由使用者決定；斷線、關閉儲存、磁碟保護、到期刪除原因應可區別。
- 下載選定來源與區間：快速模式依關鍵幀取範圍並說明實際起訖；精準裁切才重編必要邊界，採有界非同步 job，避免 HTTP request 阻塞或整段影片重編。下載權限、到期與暫存清理要完整。
- 事件詳情可帶 eventId、來源／載具及事件前後 30 秒導到此頁；EventReplayDialog 也用同一 timeline/playback service。歷史來源和載具關聯用當時版本／時間有效範圍，不拿現在標籤位置推定當時是哪台車。

## 九 歷史索引與播放路徑

1. 片段索引查重疊：`source_id = :source AND start_at < :to AND end_at > :from`，加來源／開始時間索引；量大且 EXPLAIN 證明必要時補範圍 GiST，先不另建影片搜尋引擎。
2. 查詢按實際片段邊界回傳 availability 與 gap，使用半開區間；跨午夜／來源重啟／codec 變更均應正確，不靠檔名字串解析日期作唯一事實。
3. 播放 session 保存 sourceId、revision、允許時間窗、使用者與到期，取得受保護的 manifest／媒體 URL。媒體資料走 Nginx／gateway／物件儲存，NestJS 負責授權與索引，不能讓 Node 將全部影片讀入 Buffer。
4. 起始實作可用 MediaMTX 的 `/list`、`/get` 做本機區間 adapter，或生成 HLS VOD manifest。雲端／多版本統一透過本系統索引與 manifest，不假設 MediaMTX 能直接掃 GCS。不同 codec／初始化參數之間使用正確 discontinuity／新 init，必要時建立相容 proxy。
5. 本機受控檔案支援 Range／206、Content-Type、取消請求與 seek。GCS 原片可短效簽名，但完整播放流程要處理 URL 到期；HLS manifest 及其所有子資源均需授權，不能只保護首頁 m3u8。
6. 對不支援的原碼流按來源版本＋時間窗＋preset 建 proxy cache，single-flight 合併相同任務；有 TTL、LRU、容量配額，與錄影預算一起計算。查詢不因每位使用者而複製相同代理影片。
7. 時間軸縮圖按需、低頻產生並共用快取，不對每格每秒存全尺寸 JPEG；保留 HLS 緩衝與錄影快取界線，取消錄影時不能將播放器快取永久留下。

## 十 資料庫設計

沿用 PostgreSQL／TypeORM 與 migration，使用 UTC timestamptz 或專案一致的 epoch 毫秒型別；API bigint 不經 JS number 損失精度。建議實體如下，若現有表已能覆蓋則擴充，不能重複儲存同義資料。

| 表／實體 | 必要內容 |
| --- | --- |
| video_monitor_tabs | id、name、position、tile_count 1–12、version、created_by、created_at、updated_at |
| video_monitor_tiles | id、tab_id、position、source_id 可空、display_name、recording_requested 預設 true、enabled、version；唯一 tab_id＋position |
| video_source_defaults | 場站全域模板／非敏感連線欄位、secret reference、version；只作明確套用的模板 |
| video_sources | 穩定攝影機身份、name、enabled、current_revision_id、recording_profile_id、desired／actual 狀態；UI 格子數不等於來源總數 |
| video_source_revisions | 不可變來源版本、協定、host、port、path、secret reference、主／子碼流、可選載具／位置、有效時間及時間映射資訊；不把密碼明文放 JSON |
| video_recording_profiles | 原始／平衡／節省策略、可選壓縮政策、來源 fps／碼率設定；對應型別化驗證 |
| video_storage_policies | local／GCS、根目錄的部署別名／bucket prefix、配額、保留天數、餘量、高低水位、版本；全域預設與來源覆寫清楚 |
| video_recording_segments | id、source_id、revision_id、start_at、end_at、狀態、bytes、codec／fps／尺寸、時間基準、checksum、protected_until、失敗原因；唯一 recorder 提供的片段鍵 |
| video_segment_objects | segment_id、rendition、storage_type、object_key、generation／checksum、bytes、ready/deleting/deleted；同片段可能有本機與雲端副本，不能只存單一 URL |
| video_jobs | probe／preview／upload／compress／delete／export 的持久化狀態、去重鍵、重試、lease、進度、到期、錯誤；優先沿用現有工作機制 |

播放 session 與短效 lease 可用現有 Redis；失效後不影響持久錄影索引。不要把每個解碼畫格、每秒品質樣本寫成正式操作日誌。稽核保存來源設定變更、批次套用、錄影政策異動、刪除、下載等必要操作，內容脫敏。

來源或標籤刪除為移除設定／停用，不連帶刪錄影；歷史仍以穩定 sourceId 查詢。來源真的換成不同鏡頭時提供新身份選項，不能用改名稱掩蓋歷史。

## 十一 API 契約

均在 `/syncdrive-api/video` 下，先核對現有路由並同步遷移型別與測試；以下為本次可執行設計：

| API | 行為 |
| --- | --- |
| GET/POST `/tabs`；PATCH/DELETE `/tabs/:id` | 查詢與管理標籤，樂觀鎖版本、格數及位置驗證 |
| POST `/tabs/reorder`；POST `/tabs/:id/duplicate` | 排序／複製；複製預設共用來源，不複製實體錄影 |
| PUT `/tabs/:id/tiles` | 原子保存格子配置、來源引用及 recordingRequested，最多 12 格 |
| GET/PUT `/defaults` | 讀／寫全域來源預設，回應不帶 secret |
| POST `/defaults/preview-apply`；POST `/defaults/apply` | 預覽批次差異；以版本／scope 套用，防止畫面預覽後設定已被別人改掉 |
| GET/POST `/sources`；GET/PATCH/DELETE `/sources/:id` | 來源配置／停用、遮蔽憑證；頁面初始資料可另用 `/bootstrap`，不再返回長篇 missing 清單 |
| POST `/source-tests`；GET/DELETE `/source-tests/:id` | 暫存配置測試／預覽、短效授權；限時限量，不寫正式錄影 |
| POST `/sources/:id/live-sessions` | 依能力取得 WebRTC/HLS 播放資訊、到期與狀態 |
| GET `/recordings/availability` | sourceIds、from、to，回可用區間、缺段、時間基準；限制來源數與查詢跨度 |
| GET `/recordings` | 分頁片段清單，來源、時間、狀態、大小與保護資訊；支援舊 vehicleCode 查詢呼叫者的過渡相容 |
| POST `/playback-sessions` | sourceIds 最多 12、from/to、能力資訊，建立有時間窗限制的歷史播放 |
| GET `/playback-sessions/:id/manifest` | 有授權的 HLS／播放清單與所需初始化資訊 |
| POST `/exports`；GET `/jobs/:id` | 有界區間下載任務與結果授權，不在同一 request 重編幾小時影像 |
| POST `/recordings/delete-preview`；POST `/recordings/deletions` | 預覽影響後刪除，保護與播放 lease 檢查 |
| GET/PUT `/storage-policy`；GET `/storage-status` | 實際配額、餘量、預估保存、錄影狀態與政策 |
| GET `/capabilities` | 實際 codec／硬體／協定／儲存可用性，供進階設定選項顯示 |

API 統一 DTO 白名單、URL 正規化、字串長度、pageSize、時間窗、sourceIds 上限；設定請求含 expectedVersion。即時狀態用既有 Socket 發 sourceId 與狀態，不廣播含帳密 URL。錯誤顯示「帳號或密碼錯誤」「連線逾時」「來源格式無法播放」「空間不足」等，不把內部堆疊當 UX。

## 十二 權限與必要邊界

- 沿用 `events.video.view` 看即時；新增 `events.video.configure`、`events.video.recording-manage`、`events.video-history.view`、`events.video-history.export`、`events.video-history.delete`。前後端、角色清單、migration 一起補；普通 view 不等於可改連線或刪錄影。
- 無頁面 view 隱藏入口並由後端拒絕；有 view 無動作權限依現站慣例保留按鈕，點擊提示權限不足。來源 secret 只允許寫入／替換，GET 不回原值；空白保留原 secret、明確操作才清除。
- 使用者可以設定 LAN 攝影機，不能一刀切封鎖所有私有 IP；以管理者可設定的攝影機網段／主機 allowlist 與 egress 邊界實現。阻擋 loopback、link-local、GCP metadata、未授權管理網段、DNS rebinding、跨白名單 redirect 及任意 file／shell protocol；對 HLS 子清單／segment URL 同樣驗證。
- 測試與轉碼使用固定參數 argv，不拼接 shell；固定工作根目錄與進程權限。外部 URL、模板與檔名都不能轉成可執行指令。
- 短效授權綁 session、source、動作、時間窗；登出／撤權後中止新資源請求並關閉可撤銷的現有連線。內部 MediaMTX API／metrics／hook 不公開匿名存取。[MediaMTX 授權](https://mediamtx.org/docs/features/authentication)。
- 不在主介面堆疊資安／通訊教科書；限制落實在後端與精準錯誤提示，進階設定才顯示管理者需要的資訊。

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

順序：來源／標籤 schema 與權限 → 真實接入／預覽 → 監控標籤與批次套用 → 持續錄影與容量回收 → 索引與獨立歷史頁 → 事件同步回放 → GCS／壓縮政策 → 整合與部署驗證。不要停在 UI 外殼。

必測案例：

1. 新建、改名、排序、複製、刪除標籤；1／2／4／6／9／12 格；13 格前後端都拒絕；第 12 格確實可播。重整與換帳號後場站設定仍存在。
2. 全域模板套用、逐格路徑覆寫、只填空白、明確覆蓋、版本衝突、批次部分連線失敗可重試；不把密碼放入回應、稽核或畫面。
3. RTSP、HLS 等宣告支援的來源實際測試／預覽／播放；壞憑證、逾時、不支援 codec、預覽取消、測試不開始正式錄影。
4. 新有效來源預設錄影，取消不新錄、歷史不刪；同源多格只錄一份；某格取消但其他格繼續時文案正確；關網頁仍錄，重啟續錄，重複 worker 不重錄。
5. 不同鏡頭換綁、來源 revision、車輛關聯更改、來源停用與標籤刪除，舊歷史都能正確查詢；不能把舊車畫面顯示成新車。
6. 寫入崩潰、尾段恢復、斷線缺段、時鐘偏移、跨午夜、不同 GOP、codec 切換；歷史 seek、倍速、取消舊請求、manifest 子資源、Range／206。
7. 磁碟高低水位、最低餘量、受保護片段、播放 lease、佇列配額、上傳失敗及恢復；回收不得動到事件、軌跡、資料庫與日誌。
8. GCS 上傳／checksum／generation／本機回收、soft delete 提示、遠端暫時故障、冪等重試；不使用正式 bucket 做破壞性測試。
9. AV1／HEVC／H.264 能力探測、壓縮候選品質／容量／耗時、失敗保留原檔、原子替換、無硬體 fallback；不把 VMAF 高分當唯一驗收。
10. 多來源同步、缺段獨立顯示、事件前後 30 秒連結、原碼流不相容的共用 proxy、到期授權續期與撤權；12 格沒有固定假品質數字。
11. 直接 API／Socket／manifest／segment／download 權限旁路、SSRF／metadata／DNS redirect、注入、路徑穿越；普通 LAN 攝影機在白名單內可成功設定。
12. Chrome／Safari／Edge 的實際目標瀏覽器、桌面與窄視窗、本站下拉及對話框樣式、鍵盤與焦點、空狀態、短錯誤提示。畫面不可再出現目前的黃色工程缺項列表。

使用小型合成測試串流與隔離錄影目錄，設定測試磁碟與執行時間上限、測後清理；這可驗證管線與 UI，不等於真實攝影機 12 路效能驗收。跑前後端既有測試入口、build 及本次新增的真實媒體整合測試，記錄環境／命令／結果。

最終交付：完整程式、migration、compose／Nginx／媒體配置、來源與儲存設定範例、API 型別／Swagger、操作說明、測試結果、編碼策略實測比較與部署步驟。真實來源由使用者在 UI 輸入；沒有攝影機憑證不能成為只交空 provider 的理由。尚未實機驗證的項目明列在工程交付紀錄，不把缺項清單塞回使用者首頁。
