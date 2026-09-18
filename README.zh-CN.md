<div align="center">

# Engram Vault Sync

![Engram Vault Sync：你的笔记就是 AI 的记忆，多设备同步，可被 AI 读写](assets/vault-banner.gif)

**把你的知识库同步到每台设备，并让任意 AI 读写它。** 你的笔记会变成 AI 可以检索、引用、并在此基础上继续思考的记忆。

**[在 engram.page 免费开始 →](https://engram.page)** · 无需信用卡，几分钟即可就绪。

[安装配置](#安装配置) · [连接你的 AI](#连接你的-ai) · [API](https://engram.page/docs/api) · [使用手册](docs/user-guide.md) · [自托管](https://engram.page/docs/self-host/) · [Discord](https://discord.gg/NKWcU2mm7N)

[English](README.md) · **简体中文** · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [Русский](README.ru.md) · [Italiano](README.it.md)

<a href="https://www.youtube.com/watch?v=rwnPeZ-8Lqo"><img src="assets/setup-video.jpg" alt="观看配置教程：把 Obsidian 连接到任意 AI" width="640"></a>

</div>

> 插件界面目前仅提供英文。本文档的翻译不代表软件本身已本地化。

## 你能得到什么

- **AI 在你的知识库*内部*工作。** 通过 [MCP](#连接你的-ai) 连接 Claude、Cursor 或 ChatGPT。它会读取你的笔记作为上下文，并把新笔记写回来：
- **笔记出现在每一台设备上。** 在电脑上写，手机上就能看到，AI 做的修改也会同步过来。
- **按语义或按原词查找任何内容。** 点击搜索图标并选择模式：*语义*搜索能把*“我们的退款政策”*对应到 **“客户支持手册”**，即使那篇笔记通篇没出现“政策”二字；*关键词*在本地精确匹配（离线可用，不消耗额度）；*混合*模式兼顾两者。
- **你的知识库是可编程的。** 完整的 [REST + WebSocket API](https://engram.page/docs/api) 覆盖每一条笔记：做自动化、做集成，或基于你自己的知识构建应用。

```text
你       把我们掌握的 Henderson 客户信息整理一下。

Claude   🔎  已检索你的知识库 ·  找到 4 条笔记
         他们正处于续约期，在 Q2 反馈过上手环节的问题，
         并询问过数据分析附加模块。

你       写一条笔记，重点写续约风险。

Claude   📝  已创建“Henderson：续约风险”  ✓
         并关联了那四条来源笔记。
```

<video src="assets/showcase-file-creation.webm" width="800" autoplay loop muted playsinline></video>

不会有任何内容被静默覆盖。离线期间的修改会在重新联网后同步。你的笔记只会发送到 Engram，不经过第三方，也没有任何追踪。

## 安装配置

**1. 获取一个 Engram 账号。** 使用托管版 **[engram.page](https://engram.page)**（含免费额度，无需安装任何东西），或者自行部署[源码可得的后端](https://github.com/engram-app/engram)，这样笔记永远不会离开你自己的硬件。

**2. 连接。** 打开 *Settings → Engram Vault Sync*。**托管版：** 在 Cloud 标签页点击 **Sign in**。**自托管：** 在 Self-hosted 标签页填入服务器地址和密钥。两种方式插件都会带你走完首次同步；在你确认之前不会发送任何内容。

之后，同步会随着你的工作自动进行。

**想先看演示？**[配置教程](https://www.youtube.com/watch?v=rwnPeZ-8Lqo)完整演示了上面两步。

## 连接你的 AI

Engram 使用 **MCP（Model Context Protocol，模型上下文协议）**：这是 Claude、Cursor、ChatGPT 等应用访问外部工具所用的开放标准。连接一次，你的 AI 就能直接在你自己的知识库里检索笔记、写新笔记、更新已有笔记。

把客户端指向 Engram 的 MCP 服务器（托管版为 `https://mcp.engram.page`）；各应用的分步指南见 **[集成文档](https://engram.page/docs/integrations)**。

<video src="assets/showcase-mcp.webm" width="800" autoplay loop muted playsinline></video>

## 隐私

- **网络访问与账号。** 插件只与你的 Engram 服务器通信，不联系别处，没有中间方。你通过 OAuth 登录 Engram 账号，所有套餐均可使用。也支持 API 密钥，但在 Engram Cloud 上需要 Pro 套餐；自托管服务器没有此限制。
- **无遥测。** 可选的远程日志（默认关闭）只会把错误和生命周期事件发送到你自己的服务器。
- **托管版隐私政策。** 见 [engram.page/privacy](https://engram.page/privacy)。付费套餐会提升存储与搜索额度；自托管免费。

## 更多

- **[连接你的 AI](https://engram.page/docs/integrations)**：Claude、Cursor、ChatGPT、Windsurf 等应用的 MCP 配置方法。
- **[API 参考](https://engram.page/docs/api)**：基于 REST + WebSocket API 做开发。
- **[使用手册](docs/user-guide.md)**：AI 助手、冲突处理、同步中心、问题排查。
- **[开发者指南](DEV.md)**：从源码构建、架构说明、发布流程。
- **遇到问题？**[提交 issue](https://github.com/engram-app/Engram-obsidian/issues)。
- **加入社区。** 在 [Discord](https://discord.gg/NKWcU2mm7N) 上与用户和开发者交流。
- **觉得好用？** 可通过 [GitHub Sponsors](https://github.com/sponsors/engram-app) 或 [Ko-fi](https://ko-fi.com/engrams_sync) 支持开发。完全自愿，非常感谢。

## 许可协议

[MIT](LICENSE)
