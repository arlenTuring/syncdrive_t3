# SyncDrive T3 部署

一台 GCP VM，跑資料庫、Redis、MQTT broker、後端、前端與文件站。
兩個對外埠：**80** 給我方（前端＋內部 API＋內部 Swagger），**3100** 給協力廠商。

---

## 一、我需要你提供的資訊

開機之後把下列項目給我，我可以直接把部署跑完：

| 項目 | 為什麼需要 | 範例 |
|------|-----------|------|
| **instance 名稱、zone、project** | 用 `gcloud compute ssh` 連線與同步程式碼 | `syncdrive-stage` / `asia-east1-b` / `tsdrive-prod` |
| **外部 IP** | 填 `CORS_ORIGIN`、交給廠商的 base URL、驗收時打健康檢查 | `34.80.x.x` |
| **登入帳號** | 部署腳本要用它建立 `/opt/syncdrive_t3` | `arlen` |
| **協力廠商的來源 IP／網段** | GCP 防火牆規則只放行這些來源打 3100 | `203.0.113.0/24` |
| **我方要能連 80 的來源 IP／網段** | 同上。前端與內部 Swagger 不該對全世界開 | `114.32.x.x/32` |
| **車端／模擬器連 MQTT 的來源** | 決定 `MQTT_BIND` 要不要開 `0.0.0.0` | 暫時不用就說「先不開」 |

**不需要提供**私鑰或密碼。資料庫密碼與對外 API 金鑰由 `bootstrap.sh` 在機器上用
`openssl rand` 產生，只留在 VM 的 `deploy/.env`（權限 600），不進版控。

如果這台機器我連不上（沒有 gcloud CLI、或不開對外 SSH），也可以你自己在 VM 上跑
——下面每一支腳本都是設計成人可以直接執行的。

---

## 二、GCP 這邊要先做的兩件事

**1. 開機（建議規格）**

```bash
gcloud compute instances create syncdrive-stage \
  --zone=asia-east1-b \
  --machine-type=e2-standard-4 \
  --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
  --boot-disk-size=100GB --boot-disk-type=pd-balanced \
  --tags=syncdrive
```

`e2-standard-4`（4 vCPU / 16 GB）的理由見下方〈規格依據〉。

**2. 防火牆規則**（來源網段換成實際值）

```bash
gcloud compute firewall-rules create syncdrive-partner \
  --allow=tcp:3100 --target-tags=syncdrive --source-ranges=203.0.113.0/24
gcloud compute firewall-rules create syncdrive-internal \
  --allow=tcp:80 --target-tags=syncdrive --source-ranges=114.32.0.0/16
```

**不要**開 3000、5432、6379、8080、8081。後端的 3000 根本沒發布到主機，
資料庫與 Redis 只綁 `127.0.0.1`，開發用的 Adminer 與 redis-commander 不在正式
compose 裡。

---

## 三、部署流程

### 第一次

在 VM 上：

```bash
sudo ./deploy/bootstrap.sh
```

裝 Docker、產生 `deploy/.env`（含隨機資料庫密碼與對外 API 金鑰）、設定 ufw、
建置並啟動全部服務、收緊 TimescaleDB 壓縮政策。**跑完會印出對外 API 金鑰**，
那把就是交給協力廠商的。

### 之後每次更新

在本機：

```bash
./deploy/push.sh --gcloud syncdrive-stage asia-east1-b tsdrive-prod
```

或在 VM 上：

```bash
./deploy/deploy.sh
```

流程是**先建置、再切換、然後驗收，不通過就自動回滾**。手動部署最常見的失敗
不是建置錯誤，而是換上去之後才發現不通、而舊的已經停掉了；`deploy.sh` 會記住
上一個通過健康檢查的映像標籤，新版本驗收失敗時自動切回去。

### 驗收

```bash
./deploy/healthcheck.sh
```

14 項檢查，包含**對外邊界**：內部端點與內部 Swagger 從 3100 打進去必須是 404。
那是這套部署最容易在改動中被弄壞、而且壞掉時服務看起來完全正常的一件事。

### 回滾

```bash
./deploy/deploy.sh --rollback
```

---

## 四、交給協力廠商的東西

| 項目 | 值 |
|------|-----|
| Base URL | `http://<外部 IP>:3100` |
| Swagger | `http://<外部 IP>:3100/api/docs/public` |
| 認證 | `x-api-key: <bootstrap.sh 印出的金鑰>` |
| 離線規格檔 | `backend/openapi/openapi.public.json`（`npm --prefix backend run openapi:export` 產出） |

對外目前四支：班表班次、班表站點 ETA、即時 ETA（依站）、即時 ETA（依車）。
其餘 78 支是我方內部使用，廠商既看不到文件、也打不通。

---

## 五、規格依據

依本機實測值推算：

| 項目 | 實測／估算 |
|------|-----------|
| 後端常駐記憶體 | 33 MB（閒置） |
| 資料庫現況 | 58 MB |
| 遙測寫入量 | 11 台 × 1 Hz ≈ 95 萬列／天 ≈ **1 GB／天**（需 `TELEMETRY_PERSIST_ALL=1`） |
| 遙測保留 | 7 天 → 穩態約 7 GB（壓縮政策調成 1 天後壓縮可再降） |
| 前端 build 峰值 | **3–4 GB**（`tsc -b` + `vite build`） |

記憶體的決定因素是**前端 build 峰值**，不是常駐服務。要在 VM 上建置就不能只給
8 GB；若改成本機建置、只上傳映像，`e2-standard-2`（2 vCPU / 8 GB）就夠。

**排班引擎跑在瀏覽器，不在 VM 上**——那是整套系統最吃 CPU 的部分（12 道幾何
處理、1184 班次），VM 不必為它配 CPU。

`asia-east1`（彰化）是因為協力廠商在台灣，而且驗收項目 5-201 要求「載具狀態到
圖台延遲 ≤ 1 秒」，跨區來回延遲會白白吃掉預算。

---

## 六、還沒處理的安全問題

**MQTT 1883 目前是明文、無認證。**`mosquitto/config/mosquitto.prod.conf` 已經寫好
帳密與 ACL 的設定，但預設沒有啟用。在真車或廠商要連進來之前必須先：

1. 依 `mosquitto/config/README.md` 產生 passwordfile
2. 把 compose 的 mosquitto 設定掛載改指向 `mosquitto.prod.conf`
3. 把 `MQTT_BIND` 改成 `0.0.0.0`，並用防火牆限制來源網段

在那之前 `MQTT_BIND` 保持 `127.0.0.1`，車端連不進來——這是刻意的，
1883 開著等於誰都能對車隊下指令。
