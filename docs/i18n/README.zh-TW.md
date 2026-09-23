<div align="center">

# Engram Vault Sync

![Engram Vault Sync：你的筆記就是 AI 的記憶，多裝置同步，可被 AI 讀寫](../../assets/vault-banner.gif)

**把你的知識庫同步到每一台裝置，並讓任何 AI 讀寫它。** 你的筆記會變成 AI 可以檢索、引用，並在此基礎上繼續思考的記憶。

**[在 engram.page 免費開始 →](https://engram.page)** · 無需信用卡，幾分鐘即可就緒。

[安裝設定](#安裝設定) · [連接你的 AI](#連接你的-ai) · [API](https://engram.page/docs/api) · [使用手冊](../user-guide.md) · [自行架設](https://engram.page/docs/self-host/) · [Discord](https://discord.gg/NKWcU2mm7N)

[English](../../README.md) · [简体中文](README.zh-CN.md) · **繁體中文** · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [Русский](README.ru.md) · [Italiano](README.it.md)

<a href="https://www.youtube.com/watch?v=rwnPeZ-8Lqo"><img src="../../assets/setup-video.jpg" alt="觀看設定教學：把 Obsidian 連接到任何 AI" width="640"></a>

</div>

> 外掛介面目前僅提供英文。本文件的翻譯不代表軟體本身已在地化。

## 你能得到什麼

- **AI 在你的知識庫*內部*工作。** 透過 [MCP](#連接你的-ai) 連接 Claude、Cursor 或 ChatGPT。它會讀取你的筆記作為脈絡，並把新筆記寫回來：
- **筆記出現在每一台裝置上。** 在電腦上寫，手機上就看得到，AI 做的修改也會同步過來。
- **依語意或依原詞尋找任何內容。** 點擊搜尋圖示並選擇模式：*語意*搜尋能把*「我們的退款政策」*對應到 **「客戶支援手冊」**，即使那篇筆記通篇沒出現「政策」二字；*關鍵字*在本機精確比對（離線可用，不消耗額度）；*混合*模式兼顧兩者。
- **你的知識庫是可程式化的。** 完整的 [REST + WebSocket API](https://engram.page/docs/api) 涵蓋每一則筆記：做自動化、做整合，或基於你自己的知識打造應用程式。

```text
你       把我們掌握的 Henderson 客戶資訊整理一下。

Claude   🔎  已檢索你的知識庫 ·  找到 4 則筆記
         他們正處於續約期，在 Q2 反映過導入環節的問題，
         也詢問過數據分析附加模組。

你       寫一則筆記，重點寫續約風險。

Claude   📝  已建立「Henderson：續約風險」  ✓
         並連結了那四則來源筆記。
```

<video src="../../assets/showcase-file-creation.webm" width="800" autoplay loop muted playsinline></video>

不會有任何內容被靜默覆寫。離線期間的修改會在重新連線後同步。你的筆記只會傳送到 Engram，不經過第三方，也沒有任何追蹤。

## 安裝設定

**1. 取得一個 Engram 帳號。** 使用託管版 **[engram.page](https://engram.page)**（含免費額度，無需安裝任何東西），或自行架設[原始碼可得的後端](https://github.com/engram-app/engram)，這樣筆記永遠不會離開你自己的硬體。

**2. 連接。** 開啟 *Settings → Engram Vault Sync*。**託管版：** 在 Cloud 分頁點擊 **Sign in**。**自行架設：** 在 Self-hosted 分頁填入伺服器網址與金鑰。兩種方式外掛都會帶你走完第一次同步；在你確認之前不會傳送任何內容。

之後，同步就會隨著你的工作自動進行。

**想先看示範？**[設定教學](https://www.youtube.com/watch?v=rwnPeZ-8Lqo)完整示範了上面兩個步驟。

## 連接你的 AI

Engram 使用 **MCP（Model Context Protocol，模型上下文協定）**：這是 Claude、Cursor、ChatGPT 等應用程式存取外部工具所用的開放標準。連接一次，你的 AI 就能直接在你自己的知識庫裡檢索筆記、寫新筆記、更新既有筆記。

把用戶端指向 Engram 的 MCP 伺服器（託管版為 `https://mcp.engram.page`）；各應用程式的逐步指南請見 **[整合文件](https://engram.page/docs/integrations)**。

<video src="../../assets/showcase-mcp.webm" width="800" autoplay loop muted playsinline></video>

## 隱私

- **網路存取與帳號。** 外掛只與你的 Engram 伺服器通訊，不聯繫別處，沒有中間方。你透過 OAuth 登入 Engram 帳號，所有方案皆可使用。也支援 API 金鑰，但在 Engram Cloud 上需要 Pro 方案；自行架設的伺服器沒有此限制。
- **沒有遙測。** 選用的遠端記錄（預設關閉）只會把錯誤與生命週期事件傳送到你自己的伺服器。
- **託管版隱私政策。** 請見 [engram.page/privacy](https://engram.page/privacy)。付費方案會提高儲存與搜尋額度；自行架設免費。

## 更多

- **[連接你的 AI](https://engram.page/docs/integrations)**：Claude、Cursor、ChatGPT、Windsurf 等應用程式的 MCP 設定方式。
- **[API 參考](https://engram.page/docs/api)**：基於 REST + WebSocket API 進行開發。
- **[使用手冊](../user-guide.md)**：AI 助理、衝突處理、同步中心、疑難排解。
- **[開發者指南](../../DEV.md)**：從原始碼建置、架構說明、發布流程。
- **遇到問題？**[提交 issue](https://github.com/engram-app/Engram-obsidian/issues)。
- **加入社群。** 在 [Discord](https://discord.gg/NKWcU2mm7N) 上與使用者和開發者交流。
- **覺得好用？** 可透過 [GitHub Sponsors](https://github.com/sponsors/engram-app) 或 [Ko-fi](https://ko-fi.com/engrams_sync) 支持開發。完全自願，非常感謝。

## 授權條款

[MIT](../../LICENSE). 部分內容衍生自第三方 MIT 授權作品，詳見 [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md)。
