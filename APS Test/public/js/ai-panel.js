/* ============================================================
   ai-panel.js — AI Chat Panel Logic
   ============================================================ */
'use strict';

const AIPanel = (() => {
    let chatHistory = [];
    let modelContext = null;
    let currentUrn = null;
    let isLoading = false;

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
    async function sendMessage(text) {
        if (!text.trim() || isLoading) return;
        isLoading = true;
        setSendEnabled(false);

        // Add user message
        addBubble('user', text);
        chatHistory.push({ role: 'user', content: text });
        elements.chatInput.value = '';
        autoResizeTextarea();

        // Show typing
        showTyping();

        try {
            const systemContext = modelContext
                ? `Current model URN: ${currentUrn}\nSelected elements: ${JSON.stringify(modelContext, null, 2)}`
                : currentUrn
                    ? `Current model URN: ${currentUrn}`
                    : null;

            const res = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: chatHistory, systemContext })
            });

            hideTyping();

            if (!res.ok) {
                const err = await res.json();
                addBubble('error', `Error: ${err.error || 'Unknown error'}`, true);
                return;
            }

            const data = await res.json();
            addBubble('assistant', data.reply);
            chatHistory.push({ role: 'assistant', content: data.reply });

            // Keep history manageable (last 20 messages)
            if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);

        } catch (err) {
            hideTyping();
            addBubble('error', `Network error: ${err.message}`, true);
        } finally {
            isLoading = false;
            setSendEnabled(!!elements.chatInput.value.trim());
        }
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
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(elements.chatInput.value);
            }
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

        // Listen to viewer events
        window.addEventListener('model-loaded', (e) => {
            currentUrn = e.detail.urn;
            const q = `A BIM model has been loaded (URN: ${currentUrn.slice(0, 40)}...). Please briefly summarize what you can help me with for this model.`;
            sendMessage(q);
        });

        window.addEventListener('element-selected', (e) => {
            updateContext(e.detail);
            currentUrn = e.detail.urn;
            window.showToast(`Selected: ${e.detail.name}`, 'info', 2000);
        });

        loadProviderInfo();
    }

    return { init };
})();

document.addEventListener('DOMContentLoaded', AIPanel.init);
