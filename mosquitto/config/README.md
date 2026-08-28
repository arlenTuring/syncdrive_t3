# Mosquitto 設定說明

本資料夾提供兩套設定：

| 檔案 | 用途 |
| :--- | :--- |
| `mosquitto.conf` | **開發用**。匿名開放（`allow_anonymous true`），方便模擬器直接連線。 |
| `mosquitto.prod.conf` + `aclfile` | **正式用**。車端走 TLS 用戶端憑證，後端走內部帳密，實作協議 §三 的存取隔離原則。 |

> ⚠️ 開發設定僅限本機/內網。對外部署務必改用 `mosquitto.prod.conf`。

## 正式環境的兩個 listener

| Listener | 認證方式 | 對象 | 對外開放 |
| :--- | :--- | :--- | :--- |
| `8883` | TLS 雙向驗證，用戶端憑證 CN＝`vehicle_code` | 車端（含模擬器） | 是 |
| `1883` | 帳密（`passwordfile`） | 後端 NestJS | 否，僅 docker 內部網路 |

車端（包含用來驗證流程的模擬器）**不使用帳密**，也沒有帳密可用——身分完全由憑證的 CN 決定。憑證由 `deploy/mqtt-certs.sh` 產生，其中 CA 憑證與各車的用戶端憑證／私鑰會在協力廠商呼叫 `POST /syncdrive-api/auth/token` 時一併回傳。

## 啟用正式環境設定

1. **產生 1883 密碼檔**（僅後端帳號，一次性容器執行）：

   ```bash
   docker run --rm -v "$(pwd)/mosquitto/config:/mosquitto/config" <mosquitto image> \
     mosquitto_passwd -c -b /mosquitto/config/passwordfile vtms-backend "<後端密碼>"
   ```

   `deploy/bootstrap.sh` 會自動完成這一步並寫入 `deploy/mqtt-credentials.txt`（600 權限，不提交版控）。

2. **產生 8883 的 TLS 憑證**：執行 `deploy/mqtt-certs.sh`（CA、server、各車用戶端憑證）。

3. **切換設定檔**：`docker-compose.prod.yml` 已掛載 `mosquitto.prod.conf`，不需手動切換。

4. **後端連線**：`MQTT_URL` 帶帳密，例如 `mqtt://vtms-backend:<密碼>@mosquitto:1883`。

5. **車端連線**：不帶帳密，改帶 CA 憑證與該車的用戶端憑證／私鑰（TLS mutual auth），見[車端介接說明書](../../document/車端介接說明書.md) §2.1。

`passwordfile` 與 `/mosquitto/certs/*.key` 皆含機密內容，**不應提交進版控**（已由 `.gitignore` 排除）。
