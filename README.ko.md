<div align="center">

# Engram Vault Sync

![Engram Vault Sync: 당신의 노트가 AI의 기억이 되고, 모든 기기에 동기화되며, AI가 읽고 씁니다](assets/vault-banner.gif)

**보관함을 모든 기기에 동기화하고, 어떤 AI든 읽고 쓸 수 있게 합니다.** 당신의 노트는 AI가 검색하고 인용하고 그 위에 생각을 쌓을 수 있는 기억이 됩니다.

**[engram.page에서 무료로 시작 →](https://engram.page)** · 신용카드 없이, 몇 분이면 준비됩니다.

[설치](#설치) · [AI 연결하기](#ai-연결하기) · [API](https://engram.page/docs/api) · [사용자 가이드](docs/user-guide.md) · [직접 호스팅](https://engram.page/docs/self-host/) · [Discord](https://discord.gg/NKWcU2mm7N)

[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · **한국어** · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [Русский](README.ru.md) · [Italiano](README.it.md)

<a href="https://www.youtube.com/watch?v=rwnPeZ-8Lqo"><img src="assets/setup-video.jpg" alt="설치 과정 영상: Obsidian을 어떤 AI에든 연결하기" width="640"></a>

</div>

> 플러그인 UI는 현재 영어만 제공합니다. 이 문서가 번역되어 있다는 것이 소프트웨어 자체가 한국어화되었다는 뜻은 아닙니다.

## 무엇을 할 수 있나

- **AI가 보관함 *안에서* 작동합니다.** [MCP](#ai-연결하기)로 Claude, Cursor, ChatGPT를 연결하세요. 노트를 맥락으로 읽고, 새 노트를 다시 써 넣습니다.
- **노트가 모든 기기에 나타납니다.** 노트북에서 쓰면 휴대폰에 반영되고, AI가 한 수정도 함께 도착합니다.
- **의미로도, 쓰인 단어 그대로도 찾습니다.** 검색 아이콘을 누르고 모드를 고르세요. *의미* 검색은 *"환불 정책"*에서 **"고객 지원 안내서"**를 찾아냅니다. 그 노트에 "정책"이라는 단어가 한 번도 없어도 찾습니다. *키워드*는 로컬에서 정확히 일치시킵니다(오프라인에서 동작하고 사용량을 쓰지 않습니다). *하이브리드*는 둘을 함께 씁니다.
- **보관함을 코드로 다룰 수 있습니다.** 모든 노트를 [REST + WebSocket API](https://engram.page/docs/api)로 다룹니다. 자동화하거나, 연동하거나, 자신의 지식 위에 앱을 만들 수 있습니다.

```text
나       Henderson 건에 대해 우리가 아는 걸 정리해줘.

Claude   🔎  보관함을 검색했습니다 ·  노트 4건을 찾았습니다
         현재 갱신 시기이고, 2분기에 도입 과정의 문제를 지적했으며,
         분석 애드온에 대해 문의한 적이 있습니다.

나       갱신 리스크에 집중한 노트를 만들어줘.

Claude   📝  "Henderson: 갱신 리스크"를 만들었습니다  ✓
         출처가 된 노트 4건에 연결했습니다.
```

<video src="assets/showcase-file-creation.webm" width="800" autoplay loop muted playsinline></video>

어떤 내용도 조용히 덮어써지지 않습니다. 오프라인에서 한 편집은 다시 연결되면 동기화됩니다. 노트는 Engram으로만 전송되며, 제3자를 거치지 않고 추적도 없습니다.

## 설치

**1. Engram 계정을 준비하세요.** 호스팅 버전은 **[engram.page](https://engram.page)**(무료 등급 제공, 설치할 것 없음). 또는 [소스가 공개된 백엔드](https://github.com/engram-app/engram)를 직접 호스팅하면 노트가 자신의 하드웨어를 벗어나지 않습니다.

**2. 연결하세요.** *Settings → Engram Vault Sync*를 엽니다. **호스팅:** Cloud 탭에서 **Sign in**을 클릭합니다. **직접 호스팅:** Self-hosted 탭에 서버 URL과 키를 입력합니다. 어느 방식이든 플러그인이 첫 동기화를 안내합니다. 확인하기 전에는 아무것도 전송되지 않습니다.

그다음부터는 작업하는 대로 동기화가 이루어집니다.

**영상으로 보고 싶다면?** [설치 과정 영상](https://www.youtube.com/watch?v=rwnPeZ-8Lqo)이 위 두 단계를 끝까지 다룹니다.

## AI 연결하기

Engram은 **MCP(Model Context Protocol)**를 사용합니다. Claude, Cursor, ChatGPT 등이 외부 도구에 접근할 때 쓰는 열린 표준입니다. 한 번 연결하면 AI가 자신의 보관함에서 바로 노트를 검색하고, 새 노트를 쓰고, 기존 노트를 수정할 수 있습니다.

클라이언트를 Engram MCP 서버(호스팅 버전은 `https://mcp.engram.page`)로 지정하세요. 앱별 단계별 안내는 **[연동 문서](https://engram.page/docs/integrations)**에 있습니다.

<video src="assets/showcase-mcp.webm" width="800" autoplay loop muted playsinline></video>

## 개인정보

- **네트워크 사용과 계정.** 플러그인은 당신의 Engram 서버와만 통신합니다. 다른 곳으로 보내지 않고 중개자도 없습니다. Engram 계정 OAuth 로그인으로 연결하며 모든 요금제에서 작동합니다. API 키도 지원하지만 Engram Cloud에서는 Pro 요금제가 필요합니다. 직접 호스팅한 서버에는 이 제한이 없습니다.
- **텔레메트리 없음.** 선택적 원격 로깅(기본값 꺼짐)은 오류와 수명 주기 이벤트만 당신의 서버로 보냅니다.
- **호스팅 버전 개인정보.** [engram.page/privacy](https://engram.page/privacy)를 참고하세요. 유료 등급은 저장 용량과 검색 한도를 올립니다. 직접 호스팅은 무료입니다.

## 더 보기

- **[AI 연결하기](https://engram.page/docs/integrations)**: Claude, Cursor, ChatGPT, Windsurf 등의 MCP 설정.
- **[API 참조](https://engram.page/docs/api)**: REST + WebSocket API 위에 만들기.
- **[사용자 가이드](docs/user-guide.md)**: AI 어시스턴트, 충돌, Sync Center, 문제 해결.
- **[개발자 가이드](DEV.md)**: 소스 빌드, 아키텍처, 릴리스.
- **문제가 있나요?** [이슈를 남겨주세요](https://github.com/engram-app/Engram-obsidian/issues).
- **커뮤니티에 참여하세요.** [Discord](https://discord.gg/NKWcU2mm7N)에서 사용자와 개발자와 이야기할 수 있습니다.
- **마음에 드나요?** [GitHub Sponsors](https://github.com/sponsors/engram-app) 또는 [Ko-fi](https://ko-fi.com/engrams_sync)로 개발을 후원할 수 있습니다. 선택 사항이며, 큰 도움이 됩니다.

## 라이선스

[MIT](LICENSE)
