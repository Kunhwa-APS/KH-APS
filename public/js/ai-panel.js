/* ============================================================
   ai-panel.js — AI Chat Panel Logic
   ============================================================ */
'use strict';

/**
 * Global Toast Notification System
 */
window.showToast = function (message, type = 'info', duration = 3000) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 10000;
            display: flex;
            flex-direction: column;
            gap: 10px;
            pointer-events: none;
        `;
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    const colors = {
        success: '#4CAF50',
        error: '#F44336',
        warning: '#FF9800',
        info: '#2196F3'
    };

    toast.style.cssText = `
        background: rgba(30, 30, 30, 0.9);
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-family: sans-serif;
        font-size: 14px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        border-left: 4px solid ${colors[type] || colors.info};
        min-width: 200px;
        text-align: center;
        animation: toast-in 0.3s ease-out;
        pointer-events: auto;
    `;
    toast.textContent = message;

    // Add animation styles if not present
    if (!document.getElementById('toast-anim')) {
        const style = document.createElement('style');
        style.id = 'toast-anim';
        style.textContent = `
            @keyframes toast-in {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
            }
            @keyframes toast-out {
                from { opacity: 1; transform: translateY(0); }
                to { opacity: 0; transform: translateY(-20px); }
            }
        `;
        document.head.appendChild(style);
    }

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toast-out 0.3s ease-in forwards';
        setTimeout(() => toast.remove(), 300);
    }, duration);
};

const AIPanel = (() => {
    let chatHistory = [];
    let modelContext = null;
    let currentUrn = null;
    let isLoading = false;
    let recursiveCount = 0;
    let systemContextData = null;
    let lastCallTime = 0; // [Recursion-Guard]
    let callCountInWindow = 0; // [Recursion-Guard]

    /**
     * AI에게 전달할 시스템 컨텍스트(모델 정보)를 업데이트합니다.
     */
    function updateSystemContext(summary) {
        if (!summary) return;

        currentUrn = summary.urn; // [Hands] 전역 URN 업데이트

        // 뷰어 상단 바에 표시된 실제 이름을 우선적으로 사용 (UI 동기화)
        const uiModelName = document.getElementById('viewer-model-name')?.textContent || summary.name;

        // [Viewer-Independent] 모델 정보가 없어도 이슈 데이터는 유효함
        const categoriesText = (summary.categoryList && summary.categoryList.length > 0)
            ? `[${summary.categoryList.join(', ')}]` : "N/A (모델 미로드)";
        const elementsText = (summary.categories && Object.keys(summary.categories).length > 0)
            ? Object.entries(summary.categories).map(([k, v]) => `${k}(${v}개)`).join(', ')
            : "N/A (모델 미로드)";

        systemContextData = `현재 모델 정보 (실시간):
- 파일명: ${uiModelName}
- 모델 URN: ${summary.urn}
- 전체 카테고리 목록: ${categoriesText}
- 주요 객체 현황: ${elementsText}
- 총 객체 수: ${summary.totalElements}개

[AI 지침] 우측 패널의 이슈 데이터는 모델 로딩과 무관하게 항상 유효합니다. 프로젝트 기반의 모든 질문에 최선을 다해 답변하십시오.`;

        console.log('[AI-Panel] System Context Updated (Viewer-Independent Mode):', uiModelName);
    }

    /**
     * [New] 모델 분석 진행 상태 표시
     */
    function setContextLoading(isLoading, progress = 0) {
        if (!elements.contextBody) return;

        if (isLoading) {
            elements.contextBody.innerHTML = `
                <div class="context-loading">
                    <div class="context-spinner"></div>
                    <p>모델 정보를 분석 중입니다... (${progress}%)</p>
                </div>
            `;
        } else if (progress === 0 && !modelContext) {
            elements.contextBody.innerHTML = '<p class="context-empty">No elements selected. Select elements in the viewer to add context.</p>';
        }
    }

    const elements = {
        chatMessages: null,
        chatInput: null,
        sendBtn: null,
        contextBody: null,
        aiProviderBadge: null,
        analyzeSelectionBtn: null
    };

    // ── Load AI Provider info ───────────────────────────────────
    async function loadProviderInfo() {
        try {
            const res = await fetch('/api/ai/provider');
            const data = await res.json();
            const badge = elements.aiProviderBadge;
            if (badge) {
                const label = data.provider === 'gemini' ? '✦ Google Gemini'
                    : data.provider === 'openai' ? '⬡ OpenAI GPT'
                        : data.provider === 'ollama' ? '🦙 Local Ollama'
                            : '⚠ Not Configured';
                badge.textContent = label;
            }
        } catch { /* ignore */ }
    }

    // ── Add chat bubble ─────────────────────────────────────────
    function addBubble(role, content, isError = false) {
        const container = elements.chatMessages;
        const welcome = container.querySelector('.chat-welcome');
        if (welcome) welcome.remove();

        const div = document.createElement('div');
        div.className = `chat-bubble ${isError ? 'error' : role}`;

        // Basic markdown-like formatting
        const formatted = content
            .replace(/```([\s\S]*?)```/g, '<pre>$1</pre>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
        div.innerHTML = formatted;

        // [Fix] 클릭 시 다른 요소(뷰어 등)가 이벤트를 가로채지 못하도록 전파 방지
        div.addEventListener('mousedown', (e) => e.stopPropagation());
        div.addEventListener('click', (e) => e.stopPropagation());

        const meta = document.createElement('div');
        meta.className = 'bubble-meta';
        meta.textContent = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        div.appendChild(meta);

        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
        return div;
    }

    // ── Show typing indicator ────────────────────────────────────
    function showTyping() {
        const container = elements.chatMessages;
        const div = document.createElement('div');
        div.className = 'typing-indicator';
        div.id = 'typing-indicator';
        div.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }
    function hideTyping() {
        const el = document.getElementById('typing-indicator');
        if (el) el.remove();
    }

    // ── Send chat message ───────────────────────────────────────
    async function sendMessage(text, isSystemGenerated = false) {
        if (!text.trim() || isLoading) return;

        // 🛡️ [Guardrail 4] Stack Overflow 방어 (Rate Limiting)
        const now = Date.now();
        if (now - lastCallTime < 1000) {
            callCountInWindow++;
        } else {
            lastCallTime = now;
            callCountInWindow = 1;
        }

        if (callCountInWindow > 3) {
            console.error('[AI-Panel] 과도한 자동 호출 감지 (Rate Limit Exceeded)');
            window.showToast && window.showToast("⚠️ 시스템 자동 응답이 너무 빈번하여 안전을 위해 중단되었습니다.", "error");
            isLoading = false;
            hideTyping();
            return;
        }

        // [Guardrail 1] 호출 주체 플래그 확인 (시스템 생성 시 재질의 방지)
        if (isSystemGenerated) {
            console.log('[AI-Panel] System-Generated Message Detected. AI API skip.');
        }

        // 기존 recursiveCount 로직 보존 (하위 호환성)
        if (text.includes('[SYSTEM_QUERY_AUTO_CONTINUE]')) {
            recursiveCount++;
            if (recursiveCount > 2) {
                console.error('[AI-Panel] 무한 루프 감지 - 재귀 호출 강제 중단');
                recursiveCount = 0;
                isLoading = false;
                hideTyping();
                return;
            }
        } else {
            recursiveCount = 0; // 일반 유저 쿼리 시 초기화
        }

        // [Harness-Context] 컨텍스트 누락 시 실시간 추출 명령 하달 (뷰어 의존성 제거)
        if (!systemContextData && window.ContextHarness) {
            const viewer = window._viewer || window.NOP_VIEWER || null;
            console.log('[AI-Panel] Context-Harness 호출 (On-demand, 뷰어 무관)');
            window.ContextHarness.extract(viewer);
        }

        isLoading = true;
        setSendEnabled(false);

        // [System Bypass] 자동 후속 메시지 파싱
        const isAutoContinue = text.startsWith("[SYSTEM_QUERY_AUTO_CONTINUE]");
        const isAutoUpdate = text.startsWith("[SYSTEM_QUERY_AUTO_CONTINUE_UPDATE]");
        let updateBubbleId = null;
        let actualText = text;

        if (isAutoUpdate) {
            const parts = text.split("|||");
            actualText = parts[0].replace("[SYSTEM_QUERY_AUTO_CONTINUE_UPDATE]", "").trim();
            updateBubbleId = parts[1];
        } else if (!isAutoContinue) {
            addBubble('user', text);
            chatHistory.push({ role: 'user', content: text });
            elements.chatInput.value = '';
            autoResizeTextarea();
        }

        // [Sync Waiting Constraint] 이슈 조회 시 데이터 미로드 판별
        const isIssueQuery = actualText.includes('이슈') || actualText.includes('issue');

        // 데이터 소스 통합 (IndexedDB or API Context)
        let issuesList = [];
        if (window._issueManager && window._issueManager.issues && window._issueManager.issues.length > 0) {
            issuesList = window._issueManager.issues;
        } else if (window.ContextHarness && window.ContextHarness.currentData && window.ContextHarness.currentData.issues && window.ContextHarness.currentData.issues.length > 0) {
            issuesList = window.ContextHarness.currentData.issues;
        }

        const isDataNotReady = issuesList.length === 0;

        if (!isAutoContinue && !isAutoUpdate && isIssueQuery && isDataNotReady) {
            console.log('[AI-Panel] 이슈 데이터 로드 대기 중 (Sync Waiting 발동)');
            const loadingBubbleId = 'issue-wait-' + Date.now();
            const bubble = addBubble('assistant', '데이터를 분석 중입니다... ⏳');
            bubble.id = loadingBubbleId;

            // 데이터 분석(로딩) 시간을 확보한 후 쿼리 재전송 루프
            setTimeout(() => {
                isLoading = false;
                sendMessage("[SYSTEM_QUERY_AUTO_CONTINUE_UPDATE] " + actualText + "|||" + loadingBubbleId);
            }, 1500);
            return;
        }

        showTyping();

        try {
            // [Issue-Context] 실시간 이슈 데이터(IndexedDB 또는 API 연동) 추출 및 지능형 필터링
            let issueContext = "";
            if (issuesList && issuesList.length > 0) {
                const issues = issuesList;


                // ── 컨텍스트 주입 ────────────────────────────────────────────
                // 1) 모델명: ContextHarness > IssueManager > Viewer API 순으로 취득
                // 1) 모델명: viewer API를 통한 실시간 전수 조사 (Nuclear Reset)
                const vTarget = window._viewer || window.NOP_VIEWER;
                const modelName = (vTarget && vTarget.model)
                    ? vTarget.model.getData().loadOptions.bubbleNode.getRootNode().name()
                    : '(로드된 모델 없음)';

                // 2) 구조물별 정밀 카운팅 (issues 배열 전수 조사)
                const structureCounts = {};
                issues.forEach(issue => {
                    const sn = (issue.structure_name && issue.structure_name.trim() !== '-' && issue.structure_name.trim() !== '')
                        ? issue.structure_name.trim() : '미분류';
                    structureCounts[sn] = (structureCounts[sn] || 0) + 1;
                });

                // [New] Metadata Binding: AI가 즉시 참조 가능한 인덱스 생성
                const structureIndex = JSON.stringify(structureCounts);

                // 구조물별 집계 문자열 (테이블 형식)
                const structureTable = Object.entries(structureCounts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([name, cnt]) => `  - ${name}: ${cnt}개`)
                    .join('\n');

                // 3) 이슈 상태 집계
                const openIssues = issues.filter(i => (i.status || '').toLowerCase() === 'open' || (i.status || '').toLowerCase() === 'answered').length;
                const closedIssues = issues.filter(i => (i.status || '').toLowerCase() === 'closed').length;


                // 4) 이슈 개별 데이터 (structure 필드 반드시 포함)
                const issueDetail = issues.map(i => ({
                    id: i.id,
                    title: i.title,
                    status: i.status,
                    structure: (i.structure_name && i.structure_name.trim() !== '-') ? i.structure_name.trim() : '미분류',
                    work_type: i.work_type || '',
                    assignee: i.assignee || ''
                }));

                issueContext = `## [Context-Harness] 실시간 이슈 데이터 및 인덱스 (절대 근거)
- 모델명: ${modelName}
- 전체 통계: 총 ${issues.length}개 (Open: ${openIssues}, Closed: ${closedIssues})
- **Structure Index (Count Map):** ${structureIndex}
- 구조물별 상세 현황:
${structureTable}
- 개별 이슈 데이터: ${JSON.stringify(issueDetail)}

[AI 지침] '구조물명'에 대한 질문을 받으면 위 structureIndex에서 즉시 개수를 확인하여 답변하십시오. 뷰어가 없어도 위 데이터를 기반으로 자유롭게 대화하십시오.`;

                console.log(`[Context-Harness] 데이터 바인딩 완료 - 인덱스: ${structureIndex}`);

            }

            const fullSystemContext = [
                systemContextData,
                issueContext,
                modelContext ? `사용자가 현재 선택 중인 객체: ${JSON.stringify(modelContext)}` : null
            ].filter(Boolean).join('\n\n');

            const res = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: chatHistory, systemContext: fullSystemContext })
            });

            if (!res.ok) {
                const err = await res.json();
                addBubble('error', `Error: ${err.error || 'Unknown error'}`, true);
                return;
            }

            const data = await res.json();
            const reply = data.reply;

            // ── [Reset 1] Social Bypass: JSON이 아니면 즉시 자연어 출력 ──
            const looksLikeJson = reply.trim().startsWith('{') || reply.includes('```json');
            if (!looksLikeJson) {
                console.log('[AI-Social-Bypass] 일반 대화 감지. 인터셉터 건너뜀.');
                addBubble('assistant', reply);
                chatHistory.push({ role: 'assistant', content: reply });
                return; // 프로세스 종료
            }

            // ── AI 명령어 인터셉터 및 에이전틱 피드백 루프 ──
            let displayReply = reply;
            let feedbackContent = "";
            let executionSuccess = false;

            // [Fix] Action Interceptor: "action" 또는 "command" 가 응답 어디에든 있으면 파싱 시도
            if (reply.includes('"action"') || reply.includes('"command"')) {

                // JSON 정제 파이프라인: 마크다운 코드블록, 주석, 후행 쉼표 제거
                function sanitizeJson(raw) {
                    let s = raw;
                    // 1) 마크다운 코드블록 태그 제거
                    s = s.replace(/```json\s*/gi, '').replace(/```/g, '');
                    // 2) // 한 줄 주석 제거
                    s = s.replace(/\/\/[^\n\r"]*/g, '');
                    // 3) /* ... */ 블록 주석 제거
                    s = s.replace(/\/\*[\s\S]*?\*\//g, '');
                    // 4) 후행 쉼표 제거 (JSON 표준 위반)
                    s = s.replace(/,\s*([}\]])/g, '$1');
                    // 5) 앞뒤 공백 정리
                    return s.trim();
                }

                // Cascade JSON 추출 전략: greedy → codeblock → simple
                function extractJsonCandidates(text) {
                    const candidates = [];
                    const greedy = text.match(/\{[\s\S]*\}/);
                    if (greedy) candidates.push(greedy[0]);
                    const codeblock = text.match(/```json\s*([\s\S]*?)```/);
                    if (codeblock) candidates.push(codeblock[1]);
                    const simple = text.match(/\{[^{}]*\}/g) || [];
                    candidates.push(...simple);
                    return candidates;
                }

                const jsonCandidates = extractJsonCandidates(reply);


                for (const block of jsonCandidates) {
                    let actionData = null;
                    // 정제 후 파싱 시도 (최대 2회: 원본 → 정제)
                    for (const attempt of [block, sanitizeJson(block)]) {
                        try {
                            const parsed = JSON.parse(attempt);
                            if (parsed && (parsed.action || parsed.command)) {
                                actionData = parsed;
                                break;
                            }
                        } catch (_) { /* 다음 시도로 넘어감 */ }
                    }

                    if (!actionData) {
                        console.warn('[AI-Interceptor] 모든 정제 시도 실패, 다음 블록으로 이동');
                        continue;
                    }

                    const actionName = (actionData.command || actionData.action || "").toLowerCase();
                    const supportedActions = ['select', 'highlight', 'hide', 'isolate', 'showall', 'focus', 'flyto', 'count', 'export_issues_pdf'];

                    if (actionName && supportedActions.includes(actionName)) {
                        console.log(`[AI-Action] 명령 감찰 통과: ${actionName}`, actionData);

                        // [export_issues_pdf] 즉시 실행, 재귀 루프 없음
                        if (actionName === 'export_issues_pdf') {
                            const loadingId = 'export-loading-' + Date.now();
                            const loadBubble = addBubble('assistant', '⏳ 이슈 필터링 및 선택 중...');
                            if (loadBubble) loadBubble.id = loadingId;

                            const result = await executeViewerCommand(actionData);
                            executionSuccess = true;

                            const lb = document.getElementById(loadingId);
                            if (lb) lb.remove();

                            const resultMsg = result?.success
                                ? `✅ ${result.message || '내보내기가 시작되었습니다.'}`
                                : `❌ ${result?.error || '내보내기 중 오류가 발생했습니다.'}`;

                            addBubble('assistant', resultMsg);
                            chatHistory.push({ role: 'assistant', content: resultMsg });

                            // 🛡️ [Guardrail 3] 액션 실행 후 강제 정지 (Termination)
                            feedbackContent = null;
                            executionSuccess = true;
                            console.log('[AI-Panel] Export Action Finished. Terminates here.');
                            break;
                        }

                        // 나머지 viewer 액션 → 기존 피드백 루프 방식
                        const result = await executeViewerCommand(actionData);
                        if (result && result.success) {
                            executionSuccess = true;
                            feedbackContent = `[Feedback] 명령 '${actionName}' 수행 완료. 대상: ${actionData.target || '전체'}, 결과: ${result.count || 0}개 처리. 이 성과를 바탕으로 사용자에게 보고하세요.`;
                        } else {
                            feedbackContent = `[Feedback] 명령 수행 실패. '${actionData.target}'을(를) 찾을 수 없거나 실행 중 오류 발생.`;
                        }
                        displayReply = displayReply.replace(block, '');
                        displayReply = displayReply.replace(/```json[\s\S]*?```/g, '').trim();
                        break;
                    } else if (actionName) {
                        console.warn(`[AI-Action] 미지원 액션: ${actionName}`);
                    }
                }
            }


            // 빈 JSON 껍데기 응답 차단 (실행 성공이 아닌데 텍스트도 없을 때)
            if (!executionSuccess) {
                const purelyText = displayReply.replace(/```json[\s\S]*?```|\{[\s\S]*?\}/gi, '').trim();
                if (purelyText === '') {
                    if (recursiveCount === 0) {
                        console.warn('[AI-Interceptor] 빈 JSON 껍데기 감지. 자연어 재생성 요청');
                        feedbackContent = `[Feedback] SYSTEM: 현재 응답이 화면에 아무것도 출력되지 않습니다. 반드시 한국어 자연어 문장으로만 응답 문장을 다시 작성하십시오.`;
                    } else {
                        console.warn('[AI-Interceptor] 루프 중단 - 빈 응답 대신 기본 메시지 출력');
                        displayReply = "죄송합니다. 요청하신 처리를 완료했으나 답변을 생성하는 중에 문제가 발생했습니다. 다시 한번 말씀해 주시겠어요?";
                        feedbackContent = null;
                    }
                }
            }

            if (executionSuccess && !feedbackContent) {
                // export_issues_pdf 등 완료 처리 된 경우 - 히스토리만 정리하고 재귀 없이 종료
                if (!chatHistory.find(m => m.role === 'assistant' && m.content === reply)) {
                    chatHistory.push({ role: 'assistant', content: reply });
                }
            } else if (feedbackContent) {
                // 피드백을 히스토리에 추가하고 AI에게 재질의하여 최종 응답 유도
                chatHistory.push({ role: 'assistant', content: reply });
                chatHistory.push({ role: 'system', content: feedbackContent });

                // 재귀 호출 (최종 응답 생성 - 시스템 생성 플래그 전달)
                isLoading = false;
                const nextQuery = updateBubbleId ? `[SYSTEM_QUERY_AUTO_CONTINUE_UPDATE] [SYSTEM_QUERY_AUTO_CONTINUE]|||${updateBubbleId}` : `[SYSTEM_QUERY_AUTO_CONTINUE]`;
                await sendMessage(nextQuery, true); // isSystemGenerated: true
            } else if (displayReply) {
                // 🛡️ [Guardrail] Hidden JSON: 사용자 화면에서 JSON 데이터 물리적 제거
                const cleanDisplayReply = displayReply
                    .replace(/```json[\s\S]*?```/gi, '') // 마크다운 JSON 블록 제거
                    .replace(/\{[\s\S]*"action"[\s\S]*\}/gi, '') // 일반 JSON 객체 패턴 제거
                    .trim();

                if (cleanDisplayReply || executionSuccess) {
                    const finalMsg = cleanDisplayReply || (executionSuccess ? "요청하신 작업을 수행했습니다." : "");

                    if (updateBubbleId) {
                        const upBubble = document.getElementById(updateBubbleId);
                        if (upBubble) {
                            const formatted = finalMsg
                                .replace(/```([\s\S]*?)```/g, '<pre>$1</pre>')
                                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                                .replace(/\n/g, '<br>');
                            upBubble.innerHTML = formatted;
                            const meta = document.createElement('div');
                            meta.className = 'bubble-meta';
                            meta.textContent = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                            upBubble.appendChild(meta);
                        } else {
                            addBubble('assistant', finalMsg);
                        }
                    } else if (finalMsg) {
                        addBubble('assistant', finalMsg);
                    }
                }
                chatHistory.push({ role: 'assistant', content: reply });
            }

            // Keep history manageable
            if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);

        } catch (err) {
            console.error('[AI-Panel] Send message error:', err);
            addBubble('error', `전송 실패: ${err.message}`, true);
        } finally {
            isLoading = false;
            hideTyping();
            setSendEnabled(!!elements.chatInput.value.trim());
        }
    }

    /**
     * [Action-Harness] APS Viewer 명령 실행 브릿지
     */
    async function executeViewerCommand(data) {
        if (!window.ActionHarness) {
            console.error('[AI-Panel] ActionHarness를 찾을 수 없습니다.');
            return { success: false, error: '시스템 모듈 로드 실패' };
        }

        // ActionHarness 포맷팅 (command -> action 호환성 유지)
        const commandWrapper = {
            action: (data.command || data.action || data.action_type || 'SELECT').toLowerCase(),
            target: data.target || data.category || data.item,
            params: data.params || {}
        };

        console.log('[AI-Panel] ActionHarness 위임 실행:', commandWrapper);
        const result = await window.ActionHarness.dispatch(commandWrapper);

        if (!result.success) {
            window.showToast && window.showToast(result.error || '수행 중 오류', 'warning');
        }

        return result;
    }

    // ── Analyze current selection in viewer ─────────────────────
    async function analyzeSelection() {
        if (!modelContext || !currentUrn) {
            window.showToast('First select elements in the Viewer', 'error');
            return;
        }
        const question = `Analyze the selected BIM element: "${modelContext.name}". Provide key details about its type, properties, and any relevant engineering insights.`;
        await sendMessage(question);
    }

    // ── Update context panel ────────────────────────────────────
    function updateContext(elementData) {
        modelContext = elementData;
        const body = elements.contextBody;
        body.innerHTML = '';

        const tags = [
            { label: `📦 ${elementData.name || 'Element'}` },
            { label: `🔑 ID: ${elementData.dbIds?.[0] || '?'}` },
        ];

        // Add properties
        (elementData.properties || []).slice(0, 6).forEach(p => {
            if (p.value && p.value !== '') {
                tags.push({ label: `${p.displayName}: ${p.displayValue}` });
            }
        });

        tags.forEach(t => {
            const span = document.createElement('span');
            span.className = 'context-tag';
            span.textContent = t.label;
            body.appendChild(span);
        });
    }

    /**
     * Makes the chat panel draggable by its header
     */
    function makeDraggable(panelId, headerClass) {
        const panel = document.getElementById(panelId);
        const header = panel ? panel.querySelector('.' + headerClass) : null;
        if (!panel || !header) return;

        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        header.style.cursor = 'move';
        header.title = 'Drag to move panel';

        header.onmousedown = function (e) {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;

            // Get current computed position
            const rect = panel.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;

            // Apply absolute positioning and explicit coordinates
            panel.style.margin = '0';
            panel.style.bottom = 'auto';
            panel.style.right = 'auto';
            panel.style.left = initialLeft + 'px';
            panel.style.top = initialTop + 'px';
            panel.style.position = 'fixed';

            panel.style.opacity = '0.85';
            panel.style.transition = 'none'; // Disable animations during drag

            document.onmousemove = onMouseMove;
            document.onmouseup = onMouseUp;

            e.preventDefault(); // Prevent text selection
        };

        function onMouseMove(e) {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            panel.style.left = (initialLeft + dx) + 'px';
            panel.style.top = (initialTop + dy) + 'px';
        }

        function onMouseUp() {
            isDragging = false;
            panel.style.opacity = '1';
            panel.style.transition = ''; // Restore animations
            document.onmousemove = null;
            document.onmouseup = null;
        }
    }

    /**
     * Makes the chat panel resizable
     */
    function makeResizable(panelId) {
        const panel = document.getElementById(panelId);
        if (!panel) return;

        // Add resize handle element
        let handle = panel.querySelector('.ai-resize-handle');
        if (!handle) {
            handle = document.createElement('div');
            handle.className = 'ai-resize-handle';
            handle.style.cssText = `
                position: absolute;
                right: 0;
                bottom: 0;
                width: 15px;
                height: 15px;
                cursor: nwse-resize;
                background: linear-gradient(135deg, transparent 50%, rgba(100, 116, 139, 0.4) 50%);
                border-radius: 0 0 12px 0;
                z-index: 10;
            `;
            panel.appendChild(handle);
        }

        // Ensure internal layout is flex for fluid growth
        const innerPanel = panel.querySelector('.ai-panel');
        if (innerPanel) {
            innerPanel.style.display = 'flex';
            innerPanel.style.flexDirection = 'column';
            innerPanel.style.height = '100%';
            innerPanel.style.maxHeight = 'none'; // Allow growth

            const chatBody = innerPanel.querySelector('.chat-messages');
            if (chatBody) {
                chatBody.style.flex = '1 1 auto';
                chatBody.style.overflowY = 'auto';
            }
        }

        let isResizing = false;
        let startX, startY, startW, startH;

        handle.onmousedown = function (e) {
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            startW = parseInt(document.defaultView.getComputedStyle(panel).width, 10);
            startH = parseInt(document.defaultView.getComputedStyle(panel).height, 10);

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', stopResizing);
            e.preventDefault();
        };

        function handleMouseMove(e) {
            if (!isResizing) return;
            const newW = Math.max(300, startW + (e.clientX - startX));
            const newH = Math.max(400, startH + (e.clientY - startY));
            panel.style.width = newW + 'px';
            panel.style.height = newH + 'px';
        }

        function stopResizing() {
            isResizing = false;
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', stopResizing);
        }
    }

    // ── Helpers ─────────────────────────────────────────────────
    function setSendEnabled(enabled) {
        elements.sendBtn.disabled = !enabled;
    }
    function autoResizeTextarea() {
        const ta = elements.chatInput;
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 100) + 'px';
    }

    // ── Public Init ─────────────────────────────────────────────
    function init() {
        elements.chatMessages = document.getElementById('chat-messages');
        elements.chatInput = document.getElementById('chat-input');
        elements.sendBtn = document.getElementById('send-btn');
        elements.contextBody = document.getElementById('context-body');
        elements.aiProviderBadge = document.getElementById('ai-provider-badge');
        elements.analyzeSelectionBtn = document.getElementById('analyze-selection-btn');

        // Send on click
        elements.sendBtn.addEventListener('click', () => {
            sendMessage(elements.chatInput.value);
        });

        // Send on Enter (Shift+Enter = new line)
        elements.chatInput.addEventListener('keydown', (e) => {
            // [IME] 한글 입력(컴포지션) 중에는 Enter로 메시지 보내지 않음
            if (e.isComposing || e.keyCode === 229) return;

            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(elements.chatInput.value);
            }
        });

        // [Fix] 클릭 시 강제 포커스 보장 및 전파 차단
        elements.chatInput.addEventListener('mousedown', (e) => {
            e.stopPropagation(); // 뷰어 등이 이벤트를 가로채지 못하게 방어
        });

        elements.chatInput.addEventListener('click', (e) => {
            e.stopPropagation();
            elements.chatInput.focus();
        });

        // Auto-resize and enable/disable send
        elements.chatInput.addEventListener('input', () => {
            autoResizeTextarea();
            setSendEnabled(!!elements.chatInput.value.trim());
        });

        // Analyze selection button
        elements.analyzeSelectionBtn?.addEventListener('click', analyzeSelection);

        // Clear context
        document.getElementById('clear-context-btn')?.addEventListener('click', () => {
            modelContext = null;
            elements.contextBody.innerHTML = '<p class="context-empty">No elements selected. Select elements in the viewer to add context.</p>';
        });

        // Suggestion chips
        document.querySelectorAll('.suggestion-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const q = chip.dataset.q;
                elements.chatInput.value = q;
                setSendEnabled(true);
                sendMessage(q);
            });
        });

        // [DEPRECATED] model-loaded 리스너 제거 (APS_MODEL_DATA_EXTRACTED로 통합 관리)

        // ── [NEW] 모델 메타데이터 실시간 주입 (APS_MODEL_DATA_EXTRACTED) ──
        window.addEventListener('APS_MODEL_DATA_EXTRACTED', (e) => {
            updateSystemContext(e.detail);
            window.showToast(`AI가 현재 모델을 인지했습니다.`, 'success', 3000);
        });

        // ── [NEW] 드래그 및 리사이즈 활성와 ──
        const container = document.getElementById('ai-assistant-container');
        if (container) {
            // [Fix] 초기 CSS 설정 강화
            container.style.display = 'none';
            container.style.zIndex = '2147483647';
            container.style.pointerEvents = 'auto'; // 모든 클릭 명시적 허용
            container.style.resize = 'both';
            container.style.overflow = 'hidden';
            container.style.flexDirection = 'column';

            makeDraggable('ai-assistant-container', 'ai-panel-header');
            makeResizable('ai-assistant-container');

            // [New] 입력창 포커스 자동 복구 (뷰어 로딩 시 포커스 뺏김 방지)
            const chatInput = elements.chatInput;
            const refocus = () => {
                if (window.getComputedStyle(container).display !== 'none') {
                    chatInput?.focus();
                }
            };

            // 뷰어 이벤트나 윈도우 포커스 변경 시 체크
            window.addEventListener('focus', refocus);
            container.addEventListener('click', refocus);
        }

        loadProviderInfo();

        // ── [NEW] Early Context Injection (뷰어 없이 이슈 우선 로드) ─────
        if (window.ContextHarness) {
            console.log('[AI-Panel] Page Load: 초기 이슈 데이터 수집 중...');
            window.ContextHarness.extract(null);
        }
    }

    window.AIPanel = { init, updateSystemContext, setContextLoading, sendMessage };
    return window.AIPanel;
})();

document.addEventListener('DOMContentLoaded', AIPanel.init);
