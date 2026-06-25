# Mosquitto 設定說明

本資料夾提供兩套設定：

| 檔案 | 用途 |
| :--- | :--- |
| `mosquitto.conf` | **開發用**。匿名開放（`allow_anonymous true`），方便模擬器直接連線。 |
| `mosquitto.prod.conf` + `aclfile` | **正式用**。關閉匿名、啟用帳密與 ACL，實作協議 §三 的存取隔離原則。 |

> ⚠️ 開發設定僅限本機/內網。對外部署務必改用 `mosquitto.prod.conf`。

## 啟用正式 ACL 設定

1. **產生密碼檔**（需一次，於 mosquitto 容器內執行）：

   ```bash
   # 建立中心端與後端帳號
   docker exec -it syncdrive_mosquitto \
     mosquitto_passwd -c /mosquitto/config/passwordfile vtms-center
   docker exec -it syncdrive_mosquitto \
     mosquitto_passwd /mosquitto/config/passwordfile vtms-backend

   # 為每台車建立帳號（username 必須等於 vehicle_code）
   for i in $(seq -w 1 11); do
     docker exec -it syncdrive_mosquitto \
       mosquitto_passwd -b /mosquitto/config/passwordfile "PMS-$i" "<該車密碼>"
   done
   ```

2. **切換設定檔**：在 `docker-compose.yml` 把 mosquitto 的設定掛載改為
   `./mosquitto/config/mosquitto.prod.conf:/mosquitto/config/mosquitto.conf`，
   或直接覆寫 `mosquitto.conf` 內容。

3. **後端 / 模擬器帶上帳密**：在 `MQTT_URL` 使用
   `mqtt://vtms-backend:<密碼>@host:1883`，或於 `mqtt.connect` options 補 `username`/`password`。

`passwordfile` 含雜湊後的密碼，**不應提交進版控**（已由 `.gitignore` 排除）。
