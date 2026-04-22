# APS AI Platform

Autodesk Platform Services(APS) 기반의 BIM 모델 뷰어 · 이슈/버전 관리 · AI 분석 통합 플랫폼.

---

## ✨ 주요 기능

- **BIM 모델 뷰어** — Autodesk Forge Viewer 기반 3D 모델 탐색
- **ACC / BIM 360 연동** — 허브 · 프로젝트 · 폴더 · 버전 계층 탐색
- **버전 Diff** — 모델 간 추가/삭제/변경 요소 시각화
- **Clash Detection** — Model Coordination API 결과 조회
- **이슈 관리 & PDF 보고서** — Puppeteer 기반 A4 가로 PDF 내보내기
- **AI 어시스턴트** — OpenAI · Gemini · Ollama 중 선택 (어댑터 패턴)
- **VWorld / Nominatim 지오코딩 & 타일 프록시** — 국내 주소 → 좌표 변환
- **메모 시스템** — 버전별 주석 저장/조회

---

## 🛠 기술 스택

| 레이어 | 기술 |
|---|---|
| 런타임 | Node.js 20+ · Express 5 |
| 뷰어 | Autodesk Forge Viewer 7.x |
| 지도 | Cesium · VWorld WMTS |
| PDF | Puppeteer · Handlebars |
| AI | OpenAI · Google Gemini · Ollama |
| 프론트 | Vanilla JS · Chart.js · InspireTree |

---

## 🚀 빠른 시작

### 1. 설치

```bash
npm install
```

### 2. 환경 변수 설정

```bash
cp .env.example .env
# .env 파일을 열어 APS_CLIENT_ID / APS_CLIENT_SECRET 등을 입력
```

필수 항목:
- `APS_CLIENT_ID`, `APS_CLIENT_SECRET` — https://aps.autodesk.com/myapps 에서 발급
- `APS_CALLBACK_URL` — 예: `http://localhost:8080/api/auth/callback`
- `SERVER_SESSION_SECRET` — 임의의 긴 문자열

### 3. 실행

```bash
npm start        # 운영 모드
npm run dev      # 파일 변경 감지 자동 재시작
```

→ 브라우저에서 http://localhost:8080 접속

---

## 📁 프로젝트 구조

```
├─ server.js                  # 엔트리: 미들웨어·라우트 마운트
├─ config.js                  # 환경 변수 검증 + 구조화 config
├─ middleware/                # asyncHandler, errorHandler, security, rateLimit, logger
├─ routes/                    # API 라우트 (auth, hubs, diff, clash, issues, ai, tiles, …)
├─ services/
│  ├─ aps.js                  # APS SDK 래퍼 (2-Legged 토큰 캐싱 내장)
│  ├─ ai.js                   # AI facade (어댑터 패턴)
│  ├─ ai-providers/           # openai · gemini · ollama 어댑터
│  ├─ memos.js                # 메모 저장소
│  └─ harness-brain.js        # RAG 지식 주입 (선택)
├─ utils/
│  └─ cache.js                # TTL + Inflight-dedup 메모리 캐시
├─ public/
│  ├─ index.html              # SPA 진입점
│  ├─ css/
│  │  ├─ design-system.css    # 디자인 토큰 · 컴포넌트 (ds-* 프리픽스)
│  │  ├─ ui-refresh.css       # 프리미엄 비주얼 리프레시 레이어
│  │  ├─ style.css            # 기존 스타일
│  │  └─ dashboard-premium.css
│  └─ js/                     # 뷰어·대시보드·이슈매니저·AI패널 모듈
├─ views/
│  └─ issue-report.hbs        # 이슈 PDF 템플릿
└─ _archive/                  # 레거시 디버그/실험 파일 (삭제해도 무방)
```

---

## 🔌 주요 API

| Method | Path | 설명 |
|---|---|---|
| GET  | `/health` | 헬스체크 |
| GET  | `/api/auth/login` | Autodesk OAuth 시작 |
| GET  | `/api/auth/callback` | OAuth 콜백 |
| GET  | `/api/auth/profile` | 로그인 사용자 프로필 |
| GET  | `/api/hubs` | 허브 목록 |
| GET  | `/api/hubs/:hub/projects` | 프로젝트 목록 (주소 보강) |
| GET  | `/api/hubs/:hub/projects/:proj/contents` | 폴더/파일 목록 |
| POST | `/api/diffs` | 버전 Diff 요청 |
| GET  | `/api/clash/:proj/containers` | Clash 컨테이너 |
| POST | `/api/issues/export-pdf` | 이슈 PDF 내보내기 (10/min) |
| POST | `/api/ai/chat` | AI 채팅 (30/min) |
| GET  | `/api/tiles/vworld/:layer/:z/:y/:x` | VWorld 타일 프록시 |
| GET  | `/api/geocode?address=...` | 지오코딩 |

에러 응답 포맷:
```json
{ "error": { "message": "...", "code": "APS_API_ERROR", "details": { } } }
```

---

## 🏗 아키텍처 하이라이트

- **통합 에러 처리** — `AppError` + `errorHandler` 미들웨어 → 모든 응답이 표준 JSON
- **비동기 래퍼** — `asyncHandler(fn)` 로 try/catch 제거
- **레이트 리미팅** — 비용 높은 엔드포인트(AI·PDF) IP 별 제한
- **TTL 캐시** — 프로젝트 목록(60s), 2-Legged 토큰(만료 직전까지 메모리 캐시)
- **Inflight dedup** — 동시 요청 시 외부 API 1회만 호출
- **AI 프로바이더 어댑터** — 새 LLM 추가 시 파일 1개만 생성

---

## 🔐 보안

- 프로덕션 빌드에서 `/api/debug` 엔드포인트 자동 차단
- `httpOnly` · `sameSite=lax` · `secure`(prod) 쿠키
- 보안 헤더: `X-Content-Type-Options`, `X-Frame-Options=SAMEORIGIN`, `Referrer-Policy`
- `x-powered-by` 제거
- `unhandledRejection` / `uncaughtException` 글로벌 캡처

---

## 📝 라이선스

ISC (내부 사용)
