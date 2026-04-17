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

        currentUrn = summary.urn; // 전역 URN 업데이트

        // 뷰어 상단 바에 표시된 실제 이름을 우선적으로 사용 (UI 동기화)
        const uiModelName = document.getElementById('viewer-model-name')?.textContent || summary.name;

        // 모델 정보가 없어도 이슈 데이터는 유효함
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
     * 모델 분석 진행 상태 표시
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
        if (!container) return;

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

    // ── Typing indicator ──────────────────────────────────────────
    function showTyping() {
        const container = elements.chatMessages;
        if (!container) return;
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

        // Rate Limiting Guard
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

        if (isSystemGenerated) {
            console.log('[AI-Panel] System-Generated Message Detected. AI API skip.');
        }

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
            recursiveCount = 0;
        }

        if (!systemContextData && window.ContextHarness) {
            const viewer = window._viewer || window.NOP_VIEWER || null;
            window.ContextHarness.extract(viewer);
        }

        isLoading = true;
        setSendEnabled(false);

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

        const isIssueQuery = actualText.includes('이슈') || actualText.includes('issue');

        let issuesList = [];
        if (window._issueManager && window._issueManager.issues && window._issueManager.issues.length > 0) {
            issuesList = window._issueManager.issues;
        } else if (window.ContextHarness && window.ContextHarness.currentData && window.ContextHarness.currentData.issues && window.ContextHarness.currentData.issues.length > 0) {
            issuesList = window.ContextHarness.currentData.issues;
        }

        const isDataNotReady = issuesList.length === 0;

        if (!isAutoContinue && !isAutoUpdate && isIssueQuery && isDataNotReady) {
            const loadingBubbleId = 'issue-wait-' + Date.now();
            const bubble = addBubble('assistant', '데이터를 분석 중입니다... ⏳');
            if (bubble) bubble.id = loadingBubbleId;

            setTimeout(() => {
                isLoading = false;
                sendMessage("[SYSTEM_QUERY_AUTO_CONTINUE_UPDATE] " + actualText + "|||" + loadingBubbleId);
            }, 1500);
            return;
        }

        showTyping();

        try {
            let issueContext = "";
            if (issuesList && issuesList.length > 0) {
                const issues = issuesList;
                const vTarget = window._viewer || window.NOP_VIEWER;
                const modelName = (vTarget && vTarget.model)
                    ? vTarget.model.getData().loadOptions.bubbleNode.getRootNode().name()
                    : '(로드된 모델 없음)';

                const structureCounts = {};
                issues.forEach(issue => {
                    const sn = (issue.structure_name && issue.structure_name.trim() !== '-' && issue.structure_name.trim() !== '')
                        ? issue.structure_name.trim() : '미분류';
                    structureCounts[sn] = (structureCounts[sn] || 0) + 1;
                });

                const structureIndex = JSON.stringify(structureCounts);
                const structureTable = Object.entries(structureCounts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([name, cnt]) => `  - ${name}: ${cnt}개`)
                    .join('\n');

                const openIssues = issues.filter(i => (i.status || '').toLowerCase() === 'open' || (i.status || '').toLowerCase() === 'answered').length;
                const closedIssues = issues.filter(i => (i.status || '').toLowerCase() === 'closed').length;

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

            hideTyping();

            if (!res.ok) {
                const err = await res.json();
                addBubble('error', `Error: ${err.error || 'Unknown error'}`, true);
                return;
            }

            const data = await res.json();
            const reply = data.reply;

            const looksLikeJson = reply.trim().startsWith('{') || reply.includes('```json');
            if (!looksLikeJson) {
                addBubble('assistant', reply);
                chatHistory.push({ role: 'assistant', content: reply });
                return;
            }

            // AI Action Interceptor
            let displayReply = reply;
            let feedbackContent = "";
            let executionSuccess = false;

            if (reply.includes('"action"') || reply.includes('"command"')) {
                const jsonCandidates = extractJsonCandidates(reply);

                for (const block of jsonCandidates) {
                    let actionData = null;
                    for (const attempt of [block, sanitizeJson(block)]) {
                        try {
                            const parsed = JSON.parse(attempt);
                            if (parsed && (parsed.action || parsed.command)) {
                                actionData = parsed;
                                break;
                            }
                        } catch (_) { }
                    }

                    if (!actionData) continue;

                    const actionName = (actionData.command || actionData.action || "").toLowerCase();
                    const supportedActions = ['select', 'highlight', 'hide', 'isolate', 'showall', 'focus', 'flyto', 'count', 'export_issues_pdf'];

                    if (supportedActions.includes(actionName)) {
                        if (actionName === 'export_issues_pdf') {
                            const loadingId = 'export-loading-' + Date.now();
                            const lb = addBubble('assistant', '⏳ 이슈 필터링 및 선택 중...');
                            if (lb) lb.id = loadingId;

                            const result = await executeViewerCommand(actionData);
                            const realLb = document.getElementById(loadingId);
                            if (realLb) realLb.remove();

                            const resultMsg = result?.success
                                ? `✅ ${result.message || '내보내기가 시작되었습니다.'}`
                                : `❌ ${result?.error || '내보내기 중 오류가 발생했습니다.'}`;

                            addBubble('assistant', resultMsg);
                            chatHistory.push({ role: 'assistant', content: resultMsg });
                            feedbackContent = null;
                            executionSuccess = true;
                            break;
                        }

                        const result = await executeViewerCommand(actionData);
                        if (result && result.success) {
                            executionSuccess = true;
                            feedbackContent = `[Feedback] 명령 '${actionName}' 수행 완료. 대상: ${actionData.target || '전체'}, 결과: ${result.count || 0}개 처리. 이 성과를 바탕으로 사용자에게 보고하세요.`;
                        } else {
                            feedbackContent = `[Feedback] 명령 수행 실패. '${actionData.target}'을(를) 찾을 수 없거나 실행 중 오류 발생.`;
                        }
                        displayReply = displayReply.replace(block, '').replace(/```json[\s\S]*?```/g, '').trim();
                        break;
                    }
                }
            }

            if (!executionSuccess && displayReply.replace(/```json[\s\S]*?```|\{[\s\S]*?\}/gi, '').trim() === '') {
                if (recursiveCount === 0) {
                    feedbackContent = `[Feedback] SYSTEM: 현재 응답이 화면에 아무것도 출력되지 않습니다. 반드시 한국어 자연어 문장으로만 응답 문장을 다시 작성하십시오.`;
                } else {
                    displayReply = "죄송합니다. 답변을 생성하는 중에 문제가 발생했습니다.";
                    feedbackContent = null;
                }
            }

            if (executionSuccess && !feedbackContent) {
                if (!chatHistory.find(m => m.role === 'assistant' && m.content === reply)) {
                    chatHistory.push({ role: 'assistant', content: reply });
                }
            } else if (feedbackContent) {
                chatHistory.push({ role: 'assistant', content: reply });
                chatHistory.push({ role: 'system', content: feedbackContent });
                isLoading = false;
                const nextQuery = updateBubbleId ? `[SYSTEM_QUERY_AUTO_CONTINUE_UPDATE] [SYSTEM_QUERY_AUTO_CONTINUE]|||${updateBubbleId}` : `[SYSTEM_QUERY_AUTO_CONTINUE]`;
                await sendMessage(nextQuery, true);
            } else if (displayReply) {
                const cleanDisplayReply = displayReply.replace(/```json[\s\S]*?```/gi, '').replace(/\{[\s\S]*"action"[\s\S]*\}/gi, '').trim();
                if (cleanDisplayReply || executionSuccess) {
                    const finalMsg = cleanDisplayReply || (executionSuccess ? "요청하신 작업을 수행했습니다." : "");
                    if (updateBubbleId) {
                        const upBubble = document.getElementById(updateBubbleId);
                        if (upBubble) {
                            const formatted = finalMsg.replace(/```([\s\S]*?)```/g, '<pre>$1</pre>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>').replace(/\n/g, '<br>');
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

    function sanitizeJson(raw) {
        let s = raw.replace(/```json\s*/gi, '').replace(/```/g, '');
        s = s.replace(/\/\/[^\n\r"]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
        s = s.replace(/,\s*([}\]])/g, '$1');
        return s.trim();
    }

    function extractJsonCandidates(text) {
        const candidates = [];
        const greedy = text.match(/\{[\s\S]*\}/);
        if (greedy) candidates.push(greedy[0]);
        const codeblock = text.match(/```json\s*([\s\S]*?)```/);
        if (codeblock) candidates.push(codeblock[1]);
        return candidates;
    }

    async function executeViewerCommand(data) {
        if (!window.ActionHarness) return { success: false, error: '시스템 모듈 로드 실패' };
        const commandWrapper = {
            action: (data.command || data.action || 'SELECT').toLowerCase(),
            target: data.target || data.category || data.item,
            params: data.params || {}
        };
        return await window.ActionHarness.dispatch(commandWrapper);
    }

    function makeDraggable(panelId, headerClass) {
        const panel = document.getElementById(panelId);
        const header = panel ? panel.querySelector('.' + headerClass) : null;
        if (!panel || !header) return;

        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        header.style.cursor = 'move';
        header.onmousedown = function (e) {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            panel.style.margin = '0';
            panel.style.bottom = 'auto';
            panel.style.right = 'auto';
            panel.style.left = initialLeft + 'px';
            panel.style.top = initialTop + 'px';
            panel.style.position = 'fixed';
            panel.style.transition = 'none';
            document.onmousemove = (ev) => {
                if (!isDragging) return;
                panel.style.left = (initialLeft + (ev.clientX - startX)) + 'px';
                panel.style.top = (initialTop + (ev.clientY - startY)) + 'px';
            };
            document.onmouseup = () => {
                isDragging = false;
                panel.style.transition = '';
                document.onmousemove = null;
                document.onmouseup = null;
            };
            e.preventDefault();
        };
    }

    function makeResizable(panelId) {
        const panel = document.getElementById(panelId);
        if (!panel) return;
        let handle = panel.querySelector('.ai-resize-handle');
        if (!handle) {
            handle = document.createElement('div');
            handle.className = 'ai-resize-handle';
            handle.style.cssText = `position: absolute; right: 0; bottom: 0; width: 15px; height: 15px; cursor: nwse-resize; z-index: 10;`;
            panel.appendChild(handle);
        }
        let isResizing = false;
        let startX, startY, startW, startH;
        handle.onmousedown = function (e) {
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            startW = parseInt(document.defaultView.getComputedStyle(panel).width, 10);
            startH = parseInt(document.defaultView.getComputedStyle(panel).height, 10);
            document.onmousemove = (ev) => {
                if (!isResizing) return;
                panel.style.width = Math.max(300, startW + (ev.clientX - startX)) + 'px';
                panel.style.height = Math.max(400, startH + (ev.clientY - startY)) + 'px';
            };
            document.onmouseup = () => {
                isResizing = false;
                document.onmousemove = null;
                document.onmouseup = null;
            };
            e.preventDefault();
        };
    }

    function updateContext(elementData) {
        modelContext = elementData;
        const body = elements.contextBody;
        if (!body) return;
        body.innerHTML = '';
        const tags = [{ label: `📦 ${elementData.name}` }, { label: `🔑 ID: ${elementData.dbIds?.[0]}` }];
        (elementData.properties || []).slice(0, 6).forEach(p => {
            if (p.value) tags.push({ label: `${p.displayName}: ${p.displayValue}` });
        });
        tags.forEach(t => {
            const span = document.createElement('span');
            span.className = 'context-tag';
            span.textContent = t.label;
            body.appendChild(span);
        });
    }

    function setSendEnabled(enabled) {
        if (elements.sendBtn) elements.sendBtn.disabled = !enabled;
    }

    function autoResizeTextarea() {
        const ta = elements.chatInput;
        if (!ta) return;
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 100) + 'px';
    }

    function init() {
        elements.chatMessages = document.getElementById('chat-messages');
        elements.chatInput = document.getElementById('chat-input');
        elements.sendBtn = document.getElementById('send-btn');
        elements.contextBody = document.getElementById('context-body');
        elements.aiProviderBadge = document.getElementById('ai-provider-badge');

        elements.sendBtn?.addEventListener('click', () => sendMessage(elements.chatInput.value));
        elements.chatInput?.addEventListener('keydown', (e) => {
            if (e.isComposing || e.keyCode === 229) return;
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(elements.chatInput.value);
            }
        });

        elements.chatInput?.addEventListener('mousedown', (e) => e.stopPropagation());
        elements.chatInput?.addEventListener('click', (e) => {
            e.stopPropagation();
            elements.chatInput.focus();
        });

        elements.chatInput?.addEventListener('input', () => {
            autoResizeTextarea();
            setSendEnabled(!!elements.chatInput.value.trim());
        });

        document.getElementById('clear-context-btn')?.addEventListener('click', () => {
            modelContext = null;
            elements.contextBody.innerHTML = '<p class="context-empty">No context selected.</p>';
        });

        document.querySelectorAll('.suggestion-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const q = chip.dataset.q;
                elements.chatInput.value = q;
                setSendEnabled(true);
                sendMessage(q);
            });
        });

        window.addEventListener('APS_MODEL_DATA_EXTRACTED', (e) => {
            updateSystemContext(e.detail);
            window.showToast(`AI가 현재 모델을 인지했습니다.`, 'success');
        });

        const container = document.getElementById('ai-assistant-container');
        if (container) {
            makeDraggable('ai-assistant-container', 'ai-panel-header');
            makeResizable('ai-assistant-container');
        }

        loadProviderInfo();
    }

    return { init, updateSystemContext, setContextLoading, sendMessage };
})();

document.addEventListener('DOMContentLoaded', AIPanel.init);
