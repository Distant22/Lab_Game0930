# HOOP PARTY｜手滑籃球派對

手機掃 QR Code 加入 → 主持人統一開局 → 向上滑動投球 → 時間到揭曉排行榜。

## 已有功能

- 主持人建立房間，顯示 QR Code、6 碼房號、邀請連結。
- 玩家輸入暱稱即可加入，不需要 Facebook 帳號或下載 App。
- 主持人設定每回合 **15～300 秒**，預設 60 秒；統一 3 秒倒數開局。
- 持續左右移動的籃框；手機觸控、桌面滑鼠皆可向上拖曳投籃。
- 每球 2 分；伺服器以出手方向、軌跡、籃框位置與截止時間判定，不接受客戶端上傳分數。
- 即時排行、結束排行、同分並列、自己的名次、CSV 成績下載。
- 音效開關、手機短震動（瀏覽器支援時）、練習模式、斷線自動重連、重新整理恢復身份。
- 主持人可全螢幕投影、結束後再開下一回合，已加入玩家會留在房間。

## 1. 本機啟動

需要 Node.js 22 以上。在專案資料夾執行：

```bash
npm ci
npm start
```

瀏覽器開啟 **http://localhost:3000**。可先點「先練幾球」，或「建立派對」。

### 用手機在同一個 Wi-Fi 試玩

1. 電腦和手機連到同一個 Wi-Fi。
2. 找到電腦區網 IP。macOS 可在「系統設定 → Wi-Fi → 詳細資訊 → TCP/IP」查看，或使用 `ipconfig getifaddr en0`（介面因電腦而異）。
3. 用電腦瀏覽器開啟 `http://你的區網IP:3000` 並建立派對，QR Code 就會使用這個網址。
4. 若已從 localhost 建立房間，在主持人頁面的「手機可連線的網址」填入 `http://你的區網IP:3000`，按「更新 QR」。
5. 用手機相機掃碼，輸入暱稱，再由主持人開始。

`localhost` 代表目前這台裝置，手機無法透過它連到電腦。若手機連不上，確認電腦防火牆允許 Node 連入，以及 Wi-Fi 沒有開啟裝置隔離。使用手機行動網路需先部署公開網址。

## 2. 部署到 Render（最少設定）

這個遊戲需要常駐 Node.js + WebSocket 伺服器，請使用 **Web Service**。

### 方法 A：在 Render 手動建立

1. 把此資料夾的內容上傳到新的 GitHub repository。保留 `package-lock.json`，不要上傳 `node_modules`。
2. 到 [Render Dashboard](https://dashboard.render.com/)，點 **New → Web Service**，連結 repository。
3. 設定：

| 欄位 | 值 |
| --- | --- |
| Language / Runtime | Node |
| Root Directory | 若 repository 根目錄就是本專案，留空；若整個桌面 repo 都上傳，填 `hoop-party` |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Health Check Path | `/health` |
| Environment | `NODE_ENV=production` |
| Instance Count | **1** |

4. 測試可選 Free，點 Deploy，等待服務啟動。
5. 開啟 Render 提供的 `https://你的服務.onrender.com`。建立派對後，QR Code 會自動使用正式網址；玩家可使用各自的行動網路。

### 方法 B：Blueprint

已附 `render.yaml`。在 Render 選 **New → Blueprint** 並連結這個 repository，即可讀取部署設定（預設 Free）。

Render 支援 WebSocket，HTTPS 網頁會自動使用 `wss://`。正式團康活動建議選不會閒置休眠的付費 instance；Free 在 15 分鐘無流量後會休眠，重新啟動大約需一分鐘。活動前先開站並完成一場實測。

官方文件：[Node 部署](https://render.com/docs/deploy-node-express-app)、[WebSocket](https://render.com/docs/websocket)、[Free 方案限制](https://render.com/docs/free)。

## 3. Docker / 自有主機

```bash
docker build -t hoop-party .
docker run --rm -p 3000:3000 --name hoop-party hoop-party
```

公開上線時，透過支援 WebSocket Upgrade 的 HTTPS reverse proxy 連到 3000 port。平台若指定 `PORT`，伺服器會自動使用該值。

## 現場操作

1. 主持人的電腦開首頁 → 建立派對 → 點「全螢幕」投影。
2. 設定秒數，讓玩家掃碼加入，確認在線人數。
3. 點「全員就位，開始！」。3 秒倒數後所有人開始。
4. 手指從籃球位置向上滑再放開；偏左或偏右控制方向，滑得越遠拋得越高。移動籃框需要提前瞄準。
5. 每球 2 分，以球向下穿過籃框的時間判定；哨響後才到籃框的球不計分。
6. 結束時投影與手機自動顯示排行榜。可下載 CSV，再按「再來一場」。

## 此快速版的界線

- 每房限制 100 位玩家；此為程式上限，實際承載人數仍需在選定主機與活動網路上測試。
- 房間和成績保存在**單一伺服器記憶體**。重新部署、伺服器重啟或休眠會清空房間，活動期間不要重新部署。需要永久紀錄時，先下載 CSV；後續可加 Redis／資料庫。
- 請固定 **1 個 instance**；多 instance 需要共享房間資料與跨節點廣播。
- 開局後只允許已加入者重連。新玩家等主持人按「再來一場」回等待室後加入。
- 同一瀏覽器在同一房間使用同一玩家身份。測試多位玩家請用不同瀏覽器或不同瀏覽器 profile。
- 主持人權限存在建立房間的瀏覽器 localStorage；換裝置或清除網站資料將失去該房控制權。
- 正常短暫斷線後分數可恢復，倒數持續進行；背景分頁可能被手機暫停，返回頁面後會同步。
- 基本防止改分、連續出手與未授權主持，但無帳號驗證與防機器人機制，定位為團康遊戲。
- 這是受滑動投籃玩法啟發的獨立遊戲，沒有使用 Facebook 的品牌或素材。

## 開發與驗證

```bash
npm run dev
npm test
```

自動測試涵蓋物理軌跡、時間到不計分、主持人權限、時間設定、多人加入、冷卻、進球計分、排行榜、重連與下一回合。

檔案：`server.js` 是 HTTP / WebSocket 與房間管理，`public/physics.js` 是共用物理計算，`public/app.js` 是畫面與 Canvas 球場，`public/styles.css` 是版面。
# Lab_Game0930
