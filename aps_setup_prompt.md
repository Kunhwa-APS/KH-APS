# APS 기반 AI 플랫폼 구축 - Antigravity 초기 설정 프롬프트

아래 프롬프트를 Antigravity에 입력하면 APS(Autodesk Platform Services) 기반의 AI 플랫폼 프로젝트를 체계적으로 구성할 수 있습니다.

---

## ✅ 환경 요구사항 (사전 설치 완료)

| 도구 | 버전 | 설치 방법 |
|------|------|----------|
| Git | 2.53.0 | winget install Git.Git |
| Node.js (LTS) | 24.14.0 | winget install OpenJS.NodeJS.LTS |
| npm | (Node.js 포함) | Node.js 설치 시 자동 포함 |

---

## 🚀 Antigravity 초기 설정 프롬프트

> **아래 프롬프트를 Antigravity의 채팅창에 그대로 입력하세요.**

---

```
I want to build an AI platform based on Autodesk Platform Services (APS).
Please set up a full-stack Node.js project in the current workspace (c:\APS Test) 
with the following structure and features:

## Project Overview
- Platform: Autodesk Platform Services (APS)
- Tech stack: Node.js (Express) backend + Vanilla HTML/CSS/JS frontend
- AI integration: Support for connecting AI models (LLM API like OpenAI/Gemini) 
  to analyze APS viewer data

## Project Structure to Create
```
c:\APS Test\
├── server.js                  # Express 서버 진입점
├── package.json               # 프로젝트 메타데이터 및 의존성
├── .env                       # 환경변수 (APS_CLIENT_ID, APS_CLIENT_SECRET 등)
├── .gitignore                 # node_modules, .env 제외
├── routes/
│   ├── auth.js                # APS OAuth2 인증 라우트
│   ├── models.js              # APS Data Management API 라우트
│   └── ai.js                  # AI 분석 API 라우트
├── services/
│   ├── aps.js                 # APS SDK wrapper 서비스
│   └── ai.js                  # AI API 연동 서비스
└── public/
    ├── index.html             # 메인 페이지 (APS Viewer 포함)
    ├── css/
    │   └── style.css          # 스타일시트
    └── js/
        ├── viewer.js          # Autodesk Viewer 초기화
        └── ai-panel.js        # AI 분석 패널 UI
```

## Key Features to Implement
1. **APS Authentication**: OAuth 2.0 2-legged/3-legged token management
2. **APS Viewer**: Autodesk Forge Viewer v7 integration in the frontend
3. **Data Management**: List hubs, projects, folders, and items via APS APIs
4. **AI Analysis Panel**: A sidebar panel that sends selected model metadata 
   to an AI (OpenAI GPT or Google Gemini) for analysis and Q&A
5. **REST API**: Clean RESTful API endpoints for the frontend to consume

## Dependencies to Install
Run: npm install express dotenv axios @aps_sdk/autodesk-sdkmanager @aps_sdk/authentication @aps_sdk/data-management

## Environment Variables Needed (.env)
```
APS_CLIENT_ID=your_client_id_here
APS_CLIENT_SECRET=your_client_secret_here
APS_CALLBACK_URL=http://localhost:3000/api/auth/callback
OPENAI_API_KEY=your_openai_key_here  # or GEMINI_API_KEY
PORT=3000
```

Please create all files with proper implementations, install dependencies, 
and start the development server. The UI should look modern and premium.
```

---

## 📋 APS 앱 등록 방법 (Autodesk Developer Portal)

1. [Autodesk Developer Portal](https://aps.autodesk.com/myapps/)에 접속
2. **Create App** 클릭
3. 앱 이름 입력 및 API 선택:
   - ✅ Data Management API
   - ✅ Model Derivative API
   - ✅ Viewer (무료, 별도 등록 불필요)
4. Callback URL에 `http://localhost:3000/api/auth/callback` 입력
5. 생성된 **Client ID**와 **Client Secret**을 `.env` 파일에 입력

---

## 🔗 참고 링크

- [APS 공식 튜토리얼](https://get-started.aps.autodesk.com/)
- [APS Viewer 문서](https://aps.autodesk.com/en/docs/viewer/v7/developers_guide/overview/)
- [APS Node.js SDK](https://github.com/autodesk-platform-services/aps-sdk-node)
- [APS Simple Viewer 예제](https://get-started.aps.autodesk.com/tutorials/simple-viewer/)
