# 幼稚園新書資料輸入工具（v2.0）

手機 Chrome 批量拍攝版權頁 → 雲端 OCR → 自動分欄 → 老師核對 → 匯出 Excel 97–2003（.xls）。

- 免費、無後端、無月費、免安裝
- 每部手機獨立儲存，最多 **400 條**
- 資料只存在手機瀏覽器內；相片只會上傳到你所選的 OCR 服務
- 需要網絡才可辨識；已存資料可離線查看及編輯

---

## 一、一次性設定

### 1. 上線（約 10 分鐘）

需要一個免費 GitHub 帳戶。

1. 登入 <https://github.com> → **+ → New repository**，名稱例如 `library-tool`，選 **Public**。
2. 按 **uploading an existing file**，把本資料夾內**所有檔案及資料夾**拖進去，Commit。
3. **Settings → Pages** → Source 選 `Deploy from a branch`、Branch `main`、`/ (root)`，Save。
4. 等 1–2 分鐘，網址會是 `https://tobychee696.github.io/library-tool/`（以你的帳戶為準）。

> 若用 Netlify Drop：把整個資料夾壓成 zip 拖到 <https://app.netlify.com/drop> 亦可。

### 2. 選一個 OCR 服務（二選一）

#### A. Google Cloud Vision（建議，準確度最高）

1. 到 <https://console.cloud.google.com> 建立新專案。
2. **帳單** → 連結信用卡（每月首 1,000 張免費，正常用量為 $0）。
3. **API 和服務 → 程式庫** → 搜尋 **Cloud Vision API** → 啟用。
4. **憑證 → 建立憑證 → API 金鑰**。
5. 編輯該金鑰：
   - **應用程式限制** → 網站 → 加入 `https://tobychee696.github.io/*`
   - **API 限制** → 只勾選 **Cloud Vision API**
6. （建議）**帳單 → 預算與快訊**：建立 US$1 預算並開啟 **Spend cap**（會暫停用量）。若介面沒有 Spend cap，預算只會通知、不會停用，請以程式的 950 上限為準。
7. 把金鑰貼到 App 的「更多 → 辨識服務」→ 儲存 → 測試連線。

> **多部手機**：免費 1,000 張是同一個 GCP 專案共用。若有 4 部手機，建議每部把「每月上限」設為 200，總數便不會超過 800。

#### B. OCR.space（免信用卡）

1. 到 <https://ocr.space/ocrapi> 用電郵註冊免費 API key。
2. 貼到 App → 儲存 → 測試連線。
3. 免費層每日 500 張、每張 1MB，**同一學校網絡共用**每日上限；本工具在 500 張自動停用。

### 3. （可選）AI 判斷館藏分類

在「辨識服務 → AI 判斷館藏分類」填入任何 OpenAI 相容 API（例如 OpenRouter）：

- API 網址：`https://openrouter.ai/api/v1`
- 模型：例如 `openai/gpt-4o-mini`（或其他支援 JSON 的模型）
- 只會傳送**文字**（書名、作者、出版社、辨識文字），不會上傳相片。

未設定時會用關鍵字規則分類（例如「蛋糕」→ 烹飪）。

---

## 二、日常使用

1. **拍攝**：按「拍照」或「從相簿選多張」。
2. 系統逐張上傳辨識，完成後進入 **待校對**。
3. 點卡片核對五項必填：館藏分類、條碼（ISBN）、書名、文字作者、索書號。
4. 有錯直接改；按 **已核對**（會自動返回清單）。
5. 到 **更多 → 匯出 Excel**，檔名 `library_YYYYMMDD-HHmm.xls`。

### 辨識不準時

- 按「重新辨識這張相片」再試一次。
- 或用 Google Lens／相簿的「選取文字」複製整頁文字，按「貼上文字」，系統會重新分欄。

### 索書號規則

| 情況 | 字母 |
|---|---|
| 宗教圖書 | **R**（優先） |
| 非宗教工具書／教師參考書 | **I**（優先於語言） |
| 其餘中文書 | **C** |
| 其餘英文書 | **E** |

雙語書由老師判斷；工具會依作者名是中文或英文建議 C／E。

### Excel 欄位

`資源分類`（固定「書本」）、`館藏分類`、`條碼`、`書名`、`作者`、`編號/索書號`、`出版社`、`經費來源`（留空）、`價錢`（留空）、`書本語言`（留空）、`關鍵字`（留空）。只匯出 **已核對** 的資料。

---

## 三、上限與費用保護

- **400 條**：滿 400 不能再新增，須先匯出再「全部清除」。
- **950 張／月（Vision）**：可在設定調低；用完即停止辨識，下月 1 日重置。
- **500 張／日（OCR.space）**：用完即停止，明日重置。
- 相片已存在手機；額度用完後相片仍保留，可按「重新辨識」補做。

> 注意：程式的計數存在瀏覽器內。若有人清除網站資料，計數會歸零。Vision 用戶請同時設定 GCP 的 Spend cap／預算警報，作為第二層保護。

---

## 四、注意事項

- 不要用無痕模式；不要清除 Chrome 的網站資料，否則本機資料會消失。
- 換手機／重設手機前請先匯出。
- 不同老師的手機各自獨立；合併時各自匯出，再把資料列貼到同一份範本。
- 版權頁相片會上傳到 Google 或 OCR.space 作辨識；本工具沒有自己的伺服器。
- API key 只存在該手機的 localStorage，不會寫入這個公開網站。

---

## 五、更新工具

重新上載 `index.html`、`app.js`、`ocr.js`、`styles.css`、`sw.js` 即可。程式優先讀網絡版本，離線用快取。

---

## 六、檔案結構

```
index.html            介面
styles.css            樣式
app.js                拍攝、儲存、校對、匯出
ocr.js                雲端 OCR（Vision／OCR.space）與欄位解析
sw.js                 Service Worker
manifest.webmanifest  PWA 設定
icons/                主畫面圖示
vendor/xlsx.full.min.js  Excel 產生
```

## 七、技術說明

- OCR：Google Cloud Vision `DOCUMENT_TEXT_DETECTION`（文字＋座標）或 OCR.space（`OCREngine=2`，文字＋座標）。
- 分欄：以「左標籤、右內容」的座標規則抽取作者／出版社；書名用 CIP 格式或最大字體；ISBN 做檢查碼驗證。
- Excel：SheetJS 0.20，BIFF8（Excel 97–2003），保留範本欄寬。
- 儲存：IndexedDB；相片壓縮至長邊 1600px。
