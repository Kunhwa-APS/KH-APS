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
    let lastCallTime = 0;
    let callCountInWindow = 0;

    const elements = {
        chatMessages: null,
        chatInput: null,
        sendBtn: null,
        contextBody: null,
        aiProviderBadge: null,
        analyzeSelectionBtn: null
    };

    function updateSystemContext(summary) {
        if (!summary) return;
        currentUrn = summary.urn;

        const uiModelName = document.getElementById('viewer-model-name')?.textContent || summary.name;

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

        console.log('[AI-Panel] System Context Updated:', uiModelName);
    }

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

    function addBubble(role, content, isError = false) {
        const container = elements.chatMessages;
        if (!container) return;

        const welcome = container.querySelector('.chat-welcome');
        if (welcome) welcome.remove();

        const div = document.createElement('div');
        div.className = `chat-bubble ${isError ? 'error' : role}`;

        const formatted = content
            .replace(/```json\s*[\s\S]*?```/gi, '') // Hide JSON blocks
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

    async function sendMessage(text, isSystemGenerated = false) {
        if (!text.trim() || isLoading) return;

        const now = Date.now();
        if (now - lastCallTime < 1000) {
            callCountInWindow++;
        } else {
            lastCallTime = now;
            callCountInWindow = 1;
        }

        if (callCountInWindow > 3) {
            window.showToast && window.showToast("⚠️ 과도한 자동 호출 방지를 위해 중단되었습니다.", "error");
            return;
        }

        if (text.includes('[SYSTEM_QUERY_AUTO_CONTINUE]')) {
            recursiveCount++;
            if (recursiveCount > 2) {
                recursiveCount = 0;
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
        if (window._issueManager && window._issueManager.issues) {
            issuesList = window._issueManager.issues;
        } else if (window.ContextHarness?.currentData?.issues) {
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

                const openIssues = issues.filter(i => (i.status || '').toLowerCase() !== 'closed').length;
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
- Structure Index: ${structureIndex}
- 구조물별 상세 현황:
${structureTable}
- 개별 이슈 데이터: ${JSON.stringify(issueDetail)}

[AI 지침] '구조물명'에 대한 질문을 받으면 위 structureIndex에서 즉시 개수를 확인하여 답변하십시오. 뷰어가 없어도 위 데이터를 기반으로 답변 가능합니다.`;
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

            const looksLikeJson = reply.trim().startsWith('{') || reply.includes('```json');
            if (!looksLikeJson) {
                addBubble('assistant', reply);
                chatHistory.push({ role: 'assistant', content: reply });
                return;
            }

            // Action Interceptor
            let displayReply = reply;
            let feedbackContent = "";
            let executionSuccess = false;

            if (reply.includes('"action"') || reply.includes('"command"')) {
                const jsonCandidates = extractJsonCandidates(reply);

                for (const block of jsonCandidates) {
                    let actionData = null;
                    const sanitized = sanitizeJson(block);
                    try {
                        const parsed = JSON.parse(sanitized);
                        if (parsed && (parsed.action || parsed.command)) {
                            actionData = parsed;
                        }
                    } catch (_) { }

                    if (!actionData) continue;

                    const actionName = (actionData.command || actionData.action || "").toLowerCase();
                    const supportedActions = ['select', 'highlight', 'hide', 'isolate', 'showall', 'focus', 'flyto', 'count', 'export_issues_pdf'];

                    if (supportedActions.includes(actionName)) {
                        if (actionName === 'export_issues_pdf') {
                            const result = await executeViewerCommand(actionData);
                            const resultMsg = result?.success
                                ? `✅ ${result.message || '내보내기가 시작되었습니다.'}`
                                : `❌ ${result?.error || '내보내기 중 오류가 발생했습니다.'}`;

                            addBubble('assistant', resultMsg);
                            chatHistory.push({ role: 'assistant', content: resultMsg });
                            executionSuccess = true;
                            feedbackContent = null;
                            break;
                        }

                        const result = await executeViewerCommand(actionData);
                        if (result && result.success) {
                            executionSuccess = true;
                            feedbackContent = `[Feedback] 명령 '${actionName}' 수행 완료. 대상: ${actionData.target || '전체'}, 결과: ${result.count || 0}개 처리.`;
                        } else {
                            feedbackContent = `[Feedback] 명령 수행 실패. '${actionData.target}'을(를) 찾을 수 없거나 오류 발생.`;
                        }
                        displayReply = displayReply.replace(block, '').replace(/```json[\s\S]*?```/g, '').trim();
                        break;
                    }
                }
            }

            if (feedbackContent) {
                chatHistory.push({ role: 'assistant', content: reply });
                chatHistory.push({ role: 'system', content: feedbackContent });
                isLoading = false;
                const nextQuery = updateBubbleId ? `[SYSTEM_QUERY_AUTO_CONTINUE_UPDATE] [SYSTEM_QUERY_AUTO_CONTINUE]|||${updateBubbleId}` : `[SYSTEM_QUERY_AUTO_CONTINUE]`;
                await sendMessage(nextQuery, true);
            } else if (displayReply || executionSuccess) {
                const finalMsg = displayReply || (executionSuccess ? "요청하신 작업을 수행했습니다." : "");
                if (updateBubbleId) {
                    const upBubble = document.getElementById(updateBubbleId);
                    if (upBubble) {
                        upBubble.innerHTML = finalMsg.replace(/\n/g, '<br>');
                    }
                } else if (finalMsg) {
                    addBubble('assistant', finalMsg);
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

    async function executeViewerCommand(data) {
        if (!window.ActionHarness) return { success: false, error: '시스템 모듈 로드 실패' };
        const commandWrapper = {
            action: (data.command || data.action || 'SELECT').toLowerCase(),
            target: data.target || data.category || data.item,
            params: data.params || {}
        };
        return await window.ActionHarness.dispatch(commandWrapper);
    }

    function sanitizeJson(raw) {
        let s = raw.replace(/```json\s*/gi, '').replace(/```/g, '');
        s = s.replace(/\/\/[^\n\r"]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
        s = s.replace(/,\s*([}\]])/g, '$1');
        return s.trim();
    }

    function extractJsonCandidates(text) {
        const candidates = [];
        const matches = text.match(/\{[\s\S]*?\}/g);
        if (matches) candidates.push(...matches);
        return candidates;
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

            const onMouseMove = (ev) => {
                if (!isDragging) return;
                panel.style.left = (initialLeft + (ev.clientX - startX)) + 'px';
                panel.style.top = (initialTop + (ev.clientY - startY)) + 'px';
            };

            const onMouseUp = () => {
                isDragging = false;
                panel.style.transition = '';
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
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
            handle.style.cssText = `position: absolute; right:0; bottom:0; width:15px; height:15px; cursor:nwse-resize; z-index:10;`;
            panel.appendChild(handle);
        }
        let isResizing = false;
        let startX, startY, startW, startH;

        handle.onmousedown = function (e) {
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            startW = parseInt(window.getComputedStyle(panel).width, 10);
            startH = parseInt(window.getComputedStyle(panel).height, 10);

            const onMouseMove = (ev) => {
                if (!isResizing) return;
                panel.style.width = Math.max(300, startW + (ev.clientX - startX)) + 'px';
                panel.style.height = Math.max(400, startH + (ev.clientY - startY)) + 'px';
            };

            const onMouseUp = () => {
                isResizing = false;
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            e.preventDefault();
        };
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
        if (window.ContextHarness) window.ContextHarness.extract(null);
    }

    return { init, updateSystemContext, setContextLoading, sendMessage };
})();

document.addEventListener('DOMContentLoaded', AIPanel.init);
