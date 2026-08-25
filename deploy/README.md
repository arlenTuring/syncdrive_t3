# SyncDrive T3 部署

一台主機跑完整套：資料庫、Redis、MQTT broker、後端、前端與文件站。
兩個對外埠：**80** 給我方（前端＋內部 API＋內部 Swagger），**3100** 給協力廠商。

**與機房無關。**同一份設定與同一支安裝指令，要能跑在雲端 VM，也要能跑在進場的
實體伺服器上。所以這裡不使用任何雲端供應商專屬的服務——沒有受管資料庫、沒有
映像倉庫、沒有負載平衡器。環境差異一律外部化到 `deploy/.env`，不做成兩份設定檔。

---

## 一、安裝

只有一支指令，線上與離線共用：

```bash
sudo ./deploy/bootstrap.sh
./deploy/healthcheck.sh
```

模式由「有沒有離線映像包」自動判定：

| 情況 | `bootstrap.sh` 的行為 |
|------|----------------------|
| `deploy/images/` 不存在 | 線上安裝：`docker compose build`（需外網抓 base image 與 npm 套件） |
| `deploy/images/*.tar` 存在 | 離線安裝：`docker load` 匯入，**全程不碰網路** |

跑完會印出**對外 API 金鑰**，那把是交給協力廠商的。資料庫密碼與金鑰都由
`openssl rand` 在機器上產生，寫進 `deploy/.env`（權限 600），不進版控。

### 更新

```bash
./deploy/deploy.sh              # 用目前目錄的程式碼重新部署
./deploy/deploy.sh --pull       # 先 git pull 再部署
./deploy/deploy.sh --rollback   # 回到上一個通過驗收的版本
```

先建置、再切換、然後驗收，**不通過就自動回滾**。手動部署最常見的失敗不是建置
錯誤，而是換上去之後才發現不通、而舊的已經停掉了。

### 驗收

```bash
./deploy/healthcheck.sh
```

14 項，包含**對外邊界**：內部端點與內部 Swagger 從 3100 打進去必須是 404。
那是這套部署最容易在改動中被弄壞、而且壞掉時服務看起來完全正常的一件事。

---

## 二、種子資料：新機器要能開始運作

空機起來時資料庫是空的，班表與即時 ETA 介面沒有東西可回。要帶的其實很小。

在**已經有資料的機器**上：

```bash
./deploy/seed-export.sh     # → deploy/seed/{seed.dump, published-maps.tar.gz}
```

在**新機器**上：

```bash
./deploy/seed-restore.sh
```

匯出的是 11 張定義與計畫的資料表（班表、時間模板、整備任務、車輛、設施格、
路線、圖台版面），**不含**訂單、遙測與稽核紀錄——那些是執行痕跡，新機器應該
從零開始累積自己的。

> **地圖必須用這條路走。**後端從**檔案**讀已發布地圖
> （`backend/data/published-maps/`，見 `scripts/map-published-store.js`），
> 而該目錄被 `.gitignore` 擋著。不管用 git、rsync 還是離線包送程式碼，地圖都
> 不會跟著走。少了它，班表 API 查得到班次卻查不到停靠點別名——健康檢查照樣
> 200，但回傳的內容是殘缺的。

---

## 三、資料庫獨立部署

日後資料庫要搬到另一台時，只改 `deploy/.env` 兩行：

```ini
COMPOSE_PROFILES=          # 清空 → 不啟動內建的 postgres
DB_HOST=10.0.0.9           # 指向那一台
```

compose 其餘部分完全不動，也不需要第二份設定檔。`backend` 刻意沒有對 `postgres`
下 `depends_on`——資料庫獨立部署時那個服務根本不存在，硬相依會讓整包起不來。

---

## 四、附錄 A：雲端 VM（GCP）

雲端只用到 **Compute Engine 的 VM**，沒有其他服務。

**建議規格**：`e2-standard-4`（4 vCPU / 16 GB）、100 GB `pd-balanced`、`asia-east1`。

```bash
gcloud compute instances create syncdrive-stage \
  --zone=asia-east1-b --machine-type=e2-standard-4 \
  --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
  --boot-disk-size=100GB --boot-disk-type=pd-balanced --tags=syncdrive

gcloud compute firewall-rules create syncdrive-partner \
  --allow=tcp:3100 --target-tags=syncdrive --source-ranges=<廠商網段>
gcloud compute firewall-rules create syncdrive-internal \
  --allow=tcp:80 --target-tags=syncdrive --source-ranges=<我方網段>
```

**不要**開 3000、5432、6379。後端的 3000 沒發布到主機，資料庫與 Redis 只綁
`127.0.0.1`，開發用的 Adminer 與 redis-commander 不在正式 compose 裡。

記憶體的決定因素是**前端建置峰值**（`tsc -b` + `vite build`，3–4 GB），不是常駐
服務（後端閒置時 33 MB）。若改成只匯入離線映像、不在機器上建置，8 GB 就夠。

---

## 五、附錄 B：進場實體伺服器（離線）

實體主機通常沒有外網，所以走離線包。

**第一步：在一台有網路、且 CPU 架構與目標機器相同的機器上打包。**

```bash
./deploy/pack-offline.sh v0.4.1
# → deploy/dist/syncdrive-t3-v0.4.1.tar.gz
```

> 開發用的 Mac 是 **arm64**，進場主機與 GCP VM 是 **amd64**。在 Mac 上 `docker save`
> 出來的映像放到 amd64 機器上會以 `exec format error` 收場，而那個訊息跟真正的
> 原因看起來毫無關聯。最省事的做法是**拿雲端那台 VM 當打包機**：它本來就是
> amd64，也本來就要建置。

**第二步：把 tar.gz 帶到目標主機。**

```bash
tar xzf syncdrive-t3-v0.4.1.tar.gz
cd syncdrive-t3
sudo ./deploy/bootstrap.sh
./deploy/healthcheck.sh
```

離線包含自家兩個映像與三個第三方映像（TimescaleDB、Redis、Mosquitto），
**不含 Docker 本身**——目標主機需要事先裝好 Docker Engine 與 compose plugin。

防火牆會依現場情況處理：有 `ufw` 用 ufw，有 `firewalld` 用 firewalld，兩者皆無
就印出警告要求人工確認——不會假裝設定成功。

---

## 六、交給協力廠商的東西

| 項目 | 值 |
|------|-----|
| Base URL | `http://<主機位址>:3100` |
| Swagger | `http://<主機位址>:3100/api/docs/public` |
| 認證 | `x-api-key: <bootstrap.sh 印出的金鑰>` |
| 離線規格檔 | `backend/openapi/openapi.public.json` |

對外目前四支：班表班次、班表站點 ETA、即時 ETA（依站）、即時 ETA（依車）。
其餘 78 支是我方內部使用，廠商既看不到文件、也打不通。

---

## 七、還沒處理的安全問題

**MQTT 1883 目前是明文、無認證。**`mosquitto/config/mosquitto.prod.conf` 已經寫好
帳密與 ACL，但預設沒有啟用，所以 `MQTT_BIND` 保持 `127.0.0.1`，車端連不進來
——這是刻意的，不是漏設。真車或廠商要連進來之前必須先：

1. 依 `mosquitto/config/README.md` 產生 passwordfile
2. 把 compose 的 mosquitto 設定掛載改指向 `mosquitto.prod.conf`
3. 把 `MQTT_BIND` 改成 `0.0.0.0`，並用防火牆限制來源網段

1883 開著等於誰都能對車隊下指令。
