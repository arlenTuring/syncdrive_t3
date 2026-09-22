# 訂單 API 錯誤、對帳與換證

Release 2026-09-22（新增：中心端取消訂單）。對外基址 `http://34.80.84.224:3100/syncdrive-api`。所有端點以 `x-api-key` 驗證；新發金鑰只授權本次 `vehicle_codes`。PMS99 測試請明確申請 `vehicle_codes: ["PMS99"]`。舊版未記錄車號範圍的金鑰沿用 PMS01～PMS11，請重新申請 PMS99 金鑰。

## 訂單發現與對帳

MQTT `v1/vtms/PMS99/operation/assign` 為低延遲通知，含 `order_id`，不含完整訂單；不 Retain，應用層不補發。REST 是訂單內容與狀態的權威來源。

1. MQTT 連線並確認訂閱成功後，呼叫 `GET /order/active?vehicle_code=PMS99`。
2. 回應 `{ "vehicle_code": "PMS99", "items": [...] }`。items 為完整訂單物件（格式同 queryById），包含 PENDING、PROCESSING、FAULTED，依建立時間遞增；沒有訂單時是 HTTP 200、空陣列。此版不分頁，適用聯測；FAULTED 處理後應結案。
3. 收到 assign 時呼叫 `GET /order/queryById?id=訂單編號`。通知與清單可能重複，依 `id` 去重。
4. 初次上線、每次重連、換證後必須對帳；在線時建議每 30 秒對帳一次，失敗以 5、10、30 秒退避重試。即使完全錯過 assign，仍可用清單發現訂單。
5. 依 `plannedStart` 約定執行時間；PENDING 代表等待接單。PROCESSING 是已開始的訂單，重啟後先恢復本機執行紀錄，不得再次從頭執行。FAULTED 待人工確認處理，不自動重跑。

中心端測試頁按送出即建立訂單並發 assign，指定的時間是預計執行時間，不是延遲建立時間。對方現在即可查詢，無須猜測編號。

## 中心端取消訂單

行控人員可在中心端主動取消一張尚未結案的訂單（PENDING 或 PROCESSING）。跟發車通知同一個模式：**REST 為準，MQTT 只是低延遲通知**。

1. 中心端取消當下，訂單內容立刻多一個欄位 `cancel_requested_at`（Epoch 毫秒）——`GET /order/active` 與 `GET /order/queryById` 的回應都會帶到。錯過 MQTT 通知的話，下一次對帳（初次上線、重連、換證、或例行 30 秒）就會看到這個欄位。
2. 同時發布 MQTT `v1/vtms/{vehicle_code}/operation/cancel`，只送本車，不 Retain：
   ```json
   {"vehicle_code":"PMS99","timestamp":1789693200000,"order_id":"TEST-PMS99-20260918-001"}
   ```
3. 收到通知或對帳發現 `cancel_requested_at` 後，車端停止該訂單既有任務，照現有協議呼叫 `PUT /order/updateOrderProgress/{id}?status=FAULTED` 結案——**不新增端點**，取消沿用 FAULTED 既有語意（見下方狀態轉移表）。
4. 已是終態（END、FAULTED）的訂單無法再取消，中心端會拒絕該次取消操作；車端不會因此收到任何新通知。
5. 同一張單被取消一次以後，`cancel_requested_at` 是固定值，不會因為重複取消而改變或重送 MQTT。

沒有額外車端「發起」取消的介面——取消永遠由中心端發起，車端只負責回報結案。

## 狀態與拒單

進度 Query `status` 僅接受大寫 `PROCESSING`、`END`、`FAULTED`；小寫回 400。回應的 status 也為大寫。動作 body.status 僅接受 `PENDING`、`IN_PROGRESS`、`COMPLETED`、`FAILED`。

| 目前訂單狀態 | 可轉入 |
|---|---|
| PENDING | PROCESSING、FAULTED |
| PROCESSING | END、FAULTED |
| FAULTED | PROCESSING、END |
| END | 無其他狀態 |

重送目前相同狀態回 200（冪等），可在成功回應遺失時安全重試；PENDING 不能由進度端點寫入。無法接單可直接 PENDING → FAULTED，再用 event/report 補充原因，無須短暫顯示 PROCESSING。FAULTED 處理完成後以 END 結案。沒有額外車端建立／取消訂單介面；測試頁使用中心端內部建立介面。

## HTTP 狀態與錯誤代碼

400／404 是 HTTP 大類，不是每個錯誤各自的新 HTTP 代碼。同一支 API 可因不同原因回相同 HTTP 狀態，用 JSON `code` 辨別。下表是按端點整理，401／403 的共同規則只列一次。

```json
{"statusCode":403,"code":"VEHICLE_NOT_AUTHORIZED","message":"此金鑰未授權操作該車輛訂單"}
```

| 適用端點 | HTTP | code | 意義／處理 |
|---|---:|---|---|
| 全部四支訂單端點 | 401 | INVALID_API_KEY | 金鑰缺漏、無效、過期；換取金鑰 |
| 全部四支訂單端點 | 403 | VEHICLE_NOT_AUTHORIZED | 金鑰不含查詢車號，或既存訂單／動作屬於其他車；確認 vehicle_codes |
| GET order/active | 400 | VEHICLE_CODE_REQUIRED | 缺少或空白 vehicle_code |
| GET order/queryById | 400 | ORDER_ID_REQUIRED | 缺少或空白 id |
| GET order/queryById、PUT order/updateOrderProgress/{id} | 404 | ORDER_NOT_FOUND | 訂單不存在 |
| PUT order/updateOrderProgress/{id} | 400 | STATUS_REQUIRED | 缺少或空白 status |
| PUT order/updateOrderProgress/{id} | 400 | INVALID_ORDER_STATUS | 非 PROCESSING／END／FAULTED，包含小寫與 PENDING |
| PUT order/updateOrderProgress/{id} | 400 | INVALID_ORDER_TRANSITION | 例如 PENDING → END、END → PROCESSING |
| PUT order/action/{actionId} | 404 | ACTION_NOT_FOUND | 動作不存在 |
| PUT order/action/{actionId} | 404 | ORDER_NOT_FOUND | 動作的所屬訂單不存在 |
| PUT order/action/{actionId} | 400 | INVALID_ACTION_STATUS | 動作狀態不在大寫值域 |
| PUT order/action/{actionId} | 400 | INVALID_REQUEST | JSON 欄位驗證失敗，例如 status 缺漏／非字串、時間非非負安全整數 |

驗證順序：金鑰 → 查詢資源／授權 → 進度值與狀態轉移。因此同時有多個錯誤時，回應第一個被檢出的錯誤。不存在的 URL、漏掉路徑中的 id、由對外埠呼叫內部端點，也會回框架／通道層 404，與 ORDER_NOT_FOUND 不同。JSON 語法錯誤、代理伺服器 502／503／504、未預期 500 屬共通 HTTP 錯誤，不能假設都有業務 code。逾時後先查詢再決定重試；不要把 HTTP 失敗當成訂單已完成。

## 換證與連線

重新呼叫 auth/token 不撤銷仍有效的舊 REST 金鑰或客戶端憑證，也不主動斷開既有 MQTT 連線。新舊憑據各依原定效期到期；這是可重疊換證，不保證完全沒有網路重連空窗。

建議效期剩 1 小時前換取新憑據（短效測試則於效期過半時），以原子方式保存新金鑰、CA、憑證與私鑰。REST 切換新金鑰；MQTT 更新下一次連線使用的憑證，若客戶端須重新連線才能載入，則主動重連、等訂閱成功，再立即呼叫 order/active 對帳。不可依賴長連線跨越憑證到期，下一次 TLS 握手會重新驗證有效期。

相同 MQTT clientId 的新連線可能替換舊連線，這是 broker 的連線規則，不是 auth/token 的撤證。模擬器每分鐘檢查效期、續期後更新後續重連的 TLS 憑據，並以每 30 秒及連線後對帳補足指派通知。
