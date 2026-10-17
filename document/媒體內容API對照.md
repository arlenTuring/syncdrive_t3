# 媒體內容 API 與資料欄位對照

所有端點沿用內部 Session、CSRF 與權限守衛；不接受前端指定儲存路徑。

| 方法 | 路徑 | 權限 | 說明 |
| --- | --- | --- | --- |
| GET | `/syncdrive-api/media-library/list` | `media.content.view` | 單一媒體清單、搜尋、後端排序與分頁 |
| GET | `/syncdrive-api/media-library/options` | 媒體檢視或班表檢視 | 班表／時間模板可用的媒體與非空分組 |
| GET | `/syncdrive-api/media-library/:id` | `media.content.view` | 編輯時重新載入完整資料與版本 |
| GET | `/syncdrive-api/media-library/:id/content` | `media.content.view` | 受保護檔案串流，支援 HTTP Range |
| POST | `/syncdrive-api/media-library` | `media.content.create` | multipart 建立文字或單一檔案媒體 |
| PATCH | `/syncdrive-api/media-library/:id` | `media.content.edit` | multipart 編輯；`expectedUpdatedAt` 防止覆蓋並行修改 |
| GET | `/syncdrive-api/media-library/:id/delete-impact` | `media.content.delete` | 最新分組與排程引用預覽 |
| DELETE | `/syncdrive-api/media-library/:id` | `media.content.delete` | 以預覽版本再次驗證後刪除 |

`media_library_items.kind` 保持 `media/group`；檔案類型存於 `body.mediaType`，所以既有 ID、分組 `body.mediaIds` 與排程 `media_id` 不變。本次不需新增欄位 Migration：新增中繼資料都放進既有 JSONB，舊資料不會被填造實體檔案，畫面標示為「尚無檔案」。

| JSONB 欄位 | 用途 |
| --- | --- |
| `description` | 使用者內容描述 |
| `mediaType` | `audio/text/image/video` |
| `textContent` | 純文字內容；不產生檔案、不執行 HTML |
| `file.storageKey` | 後端隨機 UUID 與受控副檔名 |
| `file.originalName` | 顯示用途的原始檔名 |
| `file.mimeType/sizeBytes/sha256` | 實際格式、容量與完整性資訊 |
| `file.durationSeconds/width/height` | `ffprobe` 可可靠取得時保存 |

刪除時在 `SERIALIZABLE` 交易中重新檢查直接排程引用，並從每個分組移除該 ID、保留其餘順序。空分組不再出現在 `/options`。歷史執行紀錄不改寫；有直接排程引用時回傳 409。
