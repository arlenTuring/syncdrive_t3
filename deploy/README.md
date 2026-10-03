# SyncDrive T3 部署

一台主機跑完整套：資料庫、Redis、MQTT broker、後端、前端與文件站。
兩個對外埠：**80** 給我方（前端＋內部 API＋內部 Swagger），**3100** 給協力廠商。

**與機房無關。**同一份設定與同一支安裝指令，要能跑在雲端 VM，也要能跑在進場的
實體伺服器上。所以這裡不使用任何雲端供應商專屬的服務——沒有受管資料庫、沒有
映像倉庫、沒有負載平衡器。環境差異一律外部化到 `deploy/.env`，不做成兩份設定檔。

---

## 一、安裝：建置一次，到處安裝

**目標機器上不建置。**就算它有網路也不建置。

在目標機器上 `npm ci` 與 `docker pull`，裝出來的內容就取決於「那一天 registry 給了
什麼」——`node:20-alpine` 這種 tag 是可變的，今天拉到的與下個月拉到的不是同一份。
於是測試過的與現場跑的不再是同一份，而這種問題最難查，因為程式碼完全沒動。

所以流程是兩段：

```
  打包機（架構＝目標機器）            任何目標機器（雲端 VM／進場主機）
  ────────────────────────           ──────────────────────────────
  ./deploy/pack-offline.sh v0.4.1  →  tar xzf syncdrive-t3-v0.4.1.tar.gz
  → deploy/dist/*.tar.gz              cd syncdrive-t3
                                      sudo ./deploy/bootstrap.sh
                                      ./deploy/healthcheck.sh
```

安裝包內含**全部**執行所需之物：自家兩個映像、三個第三方映像
（TimescaleDB／Redis／Mosquitto）、compose、腳本、mosquitto 設定，以及可選的
種子資料。安裝過程**完全不連網**。唯一的前提是目標機器已裝好 Docker Engine 與
compose plugin（安裝包不含 Docker 本身）。

實測一包約 **500 MB**。

### 版本鎖定

所有基底映像釘在 **digest**（`deploy/images.lock`），不用 tag。要升版時是有意識地
改那個檔案並重新完整測一輪，而不是「某天重建時它自己變了」。

安裝包根目錄的 `MANIFEST.txt` 記錄這一包到底是什麼：版本、git commit、架構、
自家映像的 image ID、第三方映像的 digest。現場出問題時第一個要看的就是它。

### 例外：打包機自己

打包機通常也要跑一份來驗證。`bootstrap.sh` 會依序找映像來源：安裝包 →
本機既有映像 → 都沒有就停下來說明。真的要在該機建置時明確加旗標：

```bash
sudo ./deploy/bootstrap.sh --build
```

### 更新

**正式機**：裝新的安裝包即可，同一支 `bootstrap.sh`，資料與 `.env` 都會保留。

**開發機／打包機**：

```bash
./deploy/deploy.sh              # 用目前目錄的程式碼重新部署
./deploy/deploy.sh --pull       # 先 git pull 再部署
./deploy/deploy.sh --rollback   # 回到上一個通過驗收的版本
```

先建置、再切換、然後驗收，**不通過就自動回滾**。手動部署最常見的失敗不是建置
錯誤，而是換上去之後才發現不通、而舊的已經停掉了。

### 用 git 更新 VM（取代 push.sh）

程式碼在 GitHub（`arlenTuring/syncdrive_t3`，公開，VM 用 HTTPS 拉不需要金鑰）。在**本機**
（已登入 gcloud 或能 ssh 到 VM 的那台）跑：

```bash
./deploy/git-sync.sh --gcloud <instance> <zone> [project] --api http://<VM 位址>
./deploy/git-sync.sh user@host --api http://<VM 位址>      # 一般 ssh
```

第一次會把 VM 上的 `/opt/syncdrive_t3` 轉成 git 工作目錄，切到 GitHub 的 `main`，
然後部署；`--api` 會接著升級儀表板裡存的舊系統查詢（先試跑再寫入，寫入前自動備份）。
`deploy/.env`、`deploy/.state`、`mosquitto/certs`、`backend/logs` 都在 `.gitignore`
裡，切換時不會被動到。之後每次更新再跑同一支即可，或直接在 VM 上：

```bash
cd /opt/syncdrive_t3 && sudo ./deploy/deploy.sh --pull
```

接上 git 之後就不要再用 `push.sh`：rsync 會讓工作目錄跟 git 紀錄不一致。

在沒有原始碼的機器上跑 `deploy.sh` 會直接停下並告訴你改用安裝包——安裝包刻意
不含原始碼，正式機不該保留原始碼，也不該在上面建置。

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

這台同時擔任**打包機**——它是 amd64，與進場主機相同架構，所以在這裡產出的
安裝包可以直接帶去現場。也因為要建置，記憶體的決定因素是**前端建置峰值**
（`tsc -b` + `vite build`，3–4 GB），不是常駐服務（後端閒置時 33 MB）。

純粹當安裝目標、不建置的機器，8 GB 就夠。

---

## 五、附錄 B：進場實體伺服器

流程與雲端 VM **完全一樣**——同一個安裝包、同一支 `bootstrap.sh`。

用安裝包不是因為現場沒網路（現場安裝時通常是有的），而是因為**不要讓現場去
決定裝到什麼版本**。同一包裝到哪裡都是同一份，這件事比省一次下載重要得多。

**第一步：在架構與目標機器相同的機器上打包**（雲端那台 VM 就可以）。

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

安裝包含自家兩個映像與三個第三方映像（TimescaleDB、Redis、Mosquitto），
**不含 Docker 本身**——目標主機需要事先裝好 Docker Engine 與 compose plugin。
那是唯一需要現場自行取得的東西；如果連它也要固定版本，就請系統管理員用
離線套件安裝，安裝包不介入。

防火牆會依現場情況處理：有 `ufw` 用 ufw，有 `firewalld` 用 firewalld，兩者皆無
就印出警告要求人工確認——不會假裝設定成功。

---

## 六、交給協力廠商的東西

| 項目 | 值 |
|------|-----|
| Base URL | `http://<主機位址>:3100` |
| Swagger | `http://<主機位址>:3100/api/docs/public` |
| 認證 | 廠商以帳密呼叫 `POST /syncdrive-api/auth/token` 換取 `x-api-key` 與 MQTT 客戶端憑證；帳密即 `EXTERNAL_AUTH_USER` / `EXTERNAL_AUTH_PASSWORD`（`deploy/.env`，`bootstrap.sh` 產生） |
| 對外文件 | `http://<主機位址>:3100/docs/`（介接說明書、車端介接、班表與到站預測、六份通訊協議） |

對外共 8 支（含金鑰申請）：`auth/token`、車端三支（`order/queryById`、`order/updateOrderProgress`、`order/action`）、班表兩支、即時 ETA 兩支。其餘皆為我方內部使用，廠商在對外埠（3100）既看不到文件、也打不通（一律回 `404`）。

`backend/openapi/openapi.public.json` 為本機產生的規格快照（`npm run openapi:export`），不隨映像出貨、也不對外提供下載路徑——欄位會隨版本調整，唯一的準確來源是線上 Swagger（`/api/docs/public`），有需要離線 spec 時直接從該端點下載當次版本。

---

## 七、MQTT 認證

車端與模擬器一律以 **TLS 雙向驗證＋客戶端憑證** 連線 `8883`，沒有帳密可用。憑證由 `deploy/mqtt-certs.sh` 產生（CA、server、各車客戶端憑證），廠商申請金鑰時（`POST /syncdrive-api/auth/token`）由後端一併回傳 CA 憑證與指定車輛的客戶端憑證／私鑰，不需要另外分發檔案。

`1883` 僅供後端在 docker 內部網路連線（帳密＋ACL，`mosquitto/config/README.md`），不對主機發布，車端與廠商都連不到、也不需要連。
