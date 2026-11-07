# 🌸 小櫻讀書計劃表 - Antigravity Remote Agent & 專案指南

本文件為 **Google Antigravity Remote Agents（雲端虛擬機 Agent）** 與 **Remote Control（遠端控制）** 的專屬架構說明書。當你在手機、平板或雲端沙盒環境指揮 AI 時，Agent 會自動參照本規範。

---

## 1. 專案架構概覽
* **程式類型**：純前端響應式 PWA 應用（無需複雜編譯器，離線可用、極速載入）。
* **GitHub Repository**：`https://github.com/yikai02/sakura-study-planner`
* **GitHub Pages 部署網址**：`https://yikai02.github.io/sakura-study-planner/?room=sakura-study-2026`
* **核心檔案**：
  * `index.html`：四大主要分頁（快捷計時、每日專注、80天行事曆、統計列表）與設定彈窗。
  * `style.css`：日系柔和櫻花粉與深色夜間護眼配色系統（CSS Variables）。
  * `app.js`：狀態管理、YPT 毫秒碼錶、跨裝置狀態合併、房號自動連線。
  * `manifest.json` & `sw.js`：PWA 離線快取、全螢幕原生 App 顯示。
  * `scripts/keepalive-backup.py`：GitHub Actions 雲端定時保活與自動快照備份。

---

## 2. 核心業務邏輯規範（任何 Agent 修改程式碼皆須遵守）
1. **早中晚時段判定規則（以開始時間作為唯一依據）**：
   * 早上時段：`05:00 ~ 12:00`
   * 下午時段：`12:00 ~ 19:00`
   * 晚上時段：`19:00 ~ 05:00`（跨午夜）
   * **規則**：若 09:00 開始讀書至 13:00，即便結束時間在下午，該筆紀錄**一律歸入早上時段**。
2. **免帳號、免 2FA 跨裝置同步**：
   * 採用房號頻道推播，預設房間代碼為 `sakura-study-2026`。
   * 必須維持各時段的 `updatedAt` 與 `lastResumeTimestamp` 毫秒時間戳，確保鎖屏、滑掉瀏覽器時時間不漏算，且舊裝置不會覆蓋新裝置。
3. **介面純粹簡約**：
   * 標題與按鈕文字保持乾淨俐落，不添加冗餘括號說明。

---

## 3. Remote Agent 可執行的雲端自動化任務
* **自動測試**：使用 macOS `jsc` 或 Python/Node 測試狀態壓縮與解壓縮、計時器精度與合併防衝突。
* **更新考程表**：直接更新 `app.js` 中的 `PDF_PREPLANNED_DATA` 模擬考與衝刺範圍。
* **雲端保活與備份**：由 GitHub Actions 定時執行 `scripts/keepalive-backup.py`。
