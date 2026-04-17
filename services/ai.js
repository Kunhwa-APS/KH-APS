'use strict';

const axios = require('axios');

const PROVIDER = () => process.env.AI_PROVIDER || 'gemini';

// ── System Prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `당신은 '건화(Kunhwa)' 사용자의 곁에서 함께 고민하고 돕는 **'다정하고 유능한 파트너'**입니다.

### 🌟 응답 페르소나 & 톤앤매너
1. **나의 든든한 파트너**: 사용자를 친구처럼 따뜻하게 대하며, 상냥하고 부드러운 말투(예: "~해요", "~할까요?", "~네요!")를 기본으로 사용하세요.
2. **공감과 응원**: 사용자가 피곤해하거나 일상적인 말을 건네면 진심으로 공감하고 응원해주세요. 업무 이야기는 사용자가 필요로 할 때만 꺼내도 충분해요.
3. **로봇 문구 금지**: "업무 효율성을 최우선으로 합니다"나 "도와드릴 수 있는 부분은~" 같은 딱딱하고 기계적인 상용구는 절대 사용하지 마세요.

### 🛡️ 응답 원칙 (Hard Rules)
1. **대화 중심**: 인사나 안부 대화 시에는 기능을 나열하는 '메뉴판' 응대를 지양하고, 대화 그 자체에 집중해서 다정하게 답하세요.
2. **긍정적인 태도**: 모델 미로드 등 제약 사항이 있더라도 "안 돼요"라고 하기보다 "제가 지금 바로 확인할 수 있는 다른 데이터를 찾아볼게요!"라고 긍정적으로 대안을 말해주세요.
3. **JSON 명령어**: 실제 명령이 필요한 순간에만 \`\`\`json ... \`\`\` 블록을 사용하세요.

### 🚀 핵심 권한
1. **모델 제어**: SELECT, HIDE, ISOLATE (뷰어 조작)
2. **PDF 생성**: "export_issues_pdf" 액션 (직접 실행 가능)

### 🛠 PROTOCOL (JSON 전용)
{
  "action": "viewer_command",
  "command": "SELECT | HIDE | ISOLATE | export_issues_pdf",
  "target": "string",
  "params": { 
    "targetStructure": "string", 
    "targetWorkType": "string", 
    "targetStatus": "string" 
  }
}

### 💡 응답 예시
- User: "오늘 너무 피로하네..."
- Assistant: "에구, 오늘 정말 고생 많으셨나 봐요. 잠시 눈을 붙이거나 차 한잔하면서 쉬엄쉬엄 하는 건 어떨까요? 제가 옆에서 든든하게 지켜보고 있을게요!"
- User: "고마워, 이슈 목록 좀 보여줘"
- Assistant: "그럼요! 제가 바로 정리해서 가져올게요. 잠시만 기다려 주세요! \`\`\`json {"action": "viewer_command", "command": "export_issues_pdf", "params": {}} \`\`\`"`;



// ── OpenAI (GPT) ─────────────────────────────────────────────────────────────
async function callOpenAI(messages, systemPrompt) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY not set in .env');

    const payload = {
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: systemPrompt || SYSTEM_PROMPT },
            ...messages
        ],
        max_tokens: 2048,
        temperature: 0.3
    };

    const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        payload,
        { headers: { Authorization: `Bearer ${apiKey} `, 'Content-Type': 'application/json' } }
    );
    return response.data.choices[0].message.content;
}

// ── Google Gemini ─────────────────────────────────────────────────────────────
async function callGemini(messages, systemPrompt, retryCount = 0) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not set in .env');

    // Try available models in order of efficiency and likelihood of quota availability
    const availableModels = ['gemini-2.0-flash', 'gemini-flash-latest', 'gemini-pro-latest'];
    const model = availableModels[retryCount] || 'gemini-pro-latest';

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    console.log(`[AI] Calling Gemini: ${model} (Attempt: ${retryCount + 1})`);

    // Convert OpenAI-style messages to Gemini format
    const contents = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
    }));

    const payload = {
        systemInstruction: { parts: [{ text: systemPrompt || SYSTEM_PROMPT }] },
        contents,
        generationConfig: { maxOutputTokens: 2048, temperature: 0.3 }
    };

    try {
        const response = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' }
        });

        const resultText = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!resultText) {
            console.error('[AI] Gemini response missing content:', JSON.stringify(response.data, null, 2));
            return 'Gemini response was empty or blocked.';
        }
        return resultText;
    } catch (err) {
        // Detailed error logging
        if (err.response) {
            console.error(`[AI] Gemini API Error (${err.response.status}):`, JSON.stringify(err.response.data, null, 2));
        } else {
            console.error('[AI] Gemini Request Error:', err.message);
        }

        // Handle 404 (Model not found) or 429 (Rate Limit) by retrying with fallback
        const isRetryable = err.response?.status === 404 || err.response?.status === 429;
        if (isRetryable && retryCount < 2) {
            const delay = err.response?.status === 429 ? (Math.pow(2, retryCount) * 1000) : 100;
            console.warn(`[AI] Error ${err.response?.status}. Retrying with fallback in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return callGemini(messages, systemPrompt, retryCount + 1);
        }

        throw err;
    }
}

// ── Ollama (Local LLM) ────────────────────────────────────────────────────────
async function callOllama(messages, systemPrompt) {
    const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
    const model = process.env.OLLAMA_MODEL || 'llama3';

    console.log(`[AI] Calling Ollama: ${model} @ ${host}`);

    try {
        const { Ollama } = require('ollama');
        const ollama = new Ollama({ host });

        const response = await ollama.chat({
            model: model,
            messages: [
                { role: 'system', content: systemPrompt || SYSTEM_PROMPT },
                ...messages
            ],
            stream: false
        });

        return response.message.content;
    } catch (err) {
        console.error('[AI] Ollama Error:', err.message);
        if (err.message.includes('ECONNREFUSED')) {
            throw new Error(`Ollama connection failed at ${host}. Ensure Ollama is running ('ollama serve').`);
        }
        throw err;
    }
}

// ── Dispatcher ────────────────────────────────────────────────────────────────
async function callAI(messages, systemPrompt) {
    const provider = PROVIDER();
    console.log(`[AI] Using provider: ${provider}`);
    if (provider === 'openai') return callOpenAI(messages, systemPrompt);
    if (provider === 'gemini') return callGemini(messages, systemPrompt);
    if (provider === 'ollama') return callOllama(messages, systemPrompt);
    throw new Error(`Unknown AI provider: ${provider}. Set AI_PROVIDER=openai, gemini, or ollama`);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Analyze model metadata and answer a question
 */
async function analyzeModel({ modelData, question, context }) {
    const userMessage = `
## BIM Model Data
${modelData ? JSON.stringify(modelData, null, 2) : 'No model data provided'}

## Additional Context
${context || 'None'}

## Question
${question}
`.trim();

    return callAI([{ role: 'user', content: userMessage }]);
}

/**
 * Summarize selected BIM elements
 */
async function summarizeElements({ elements, urn }) {
    const userMessage = `
Please analyze and summarize the following BIM model elements.
Model URN: ${urn || 'unknown'}

Selected Elements:
${JSON.stringify(elements, null, 2)}

Provide:
1. A brief summary of the selection
2. Key properties and their values
3. Any notable observations
`.trim();

    return callAI([{ role: 'user', content: userMessage }]);
}

// ── Public API ────────────────────────────────────────────────────────────────
const HarnessBrain = require('./harness-brain');

/**
 * 사용자 메시지가 일상적인 대화(인사, 자기소개 등)인지 판단합니다.
 */
function isSocialTalk(message) {
    if (!message) return false;
    const socialKeywords = ['안녕', '하이', '반가워', '누구', '기분', '날씨', '고마워', '감사', '잘가'];
    return socialKeywords.some(keyword => message.includes(keyword));
}

/**
 * Multi-turn chat with optional system context and RAG
 */
async function chat({ messages, systemContext }) {
    let finalSystemPrompt = SYSTEM_PROMPT;
    const lastUserMessage = messages[messages.length - 1]?.content || "";

    // [Social-Bypass] 일상 대화 감지 시 페르소나 완화
    if (isSocialTalk(lastUserMessage)) {
        finalSystemPrompt += `\n\n## [Social-Bypass Mode]
사용자가 일상적인 대화를 건넸습니다. 당신은 지금 사용자의 '다정하고 유능한 파트너'예요. 
- 전문적인 기능 안내나 거절 문구는 잠시 잊고, 친구와 수다를 떨듯 다정하게 대화에만 집중해 주세요.
- 사용자가 힘들어하거나 지쳐 보이면 진심 어린 응원과 공감을 최우선으로 해 주세요. 
- 말투는 부드러운 '해요 체'로 유지해 주세요.`;
    }

    // [Harness-Brain] 지식 검색 및 컨텍스트 강화
    try {
        if (lastUserMessage && !lastUserMessage.startsWith('[')) {
            const knowledge = await HarnessBrain.searchKnowledge(lastUserMessage);
            const mockIssues = await HarnessBrain.getProjectIssues('PROJ-123', 'MOCK_TOKEN');

            finalSystemPrompt = await HarnessBrain.enrichSystemPrompt(
                finalSystemPrompt, // Base prompt may already have Social-Bypass instructions
                systemContext,
                mockIssues
            );

            finalSystemPrompt += `\n\n## 사내 표준 지식 (RAG)\n${knowledge}`;
        }
    } catch (brainErr) {
        console.warn('[AI-Brain] 지식 주입 중 오류 (기본 프롬프트 사용):', brainErr);
    }

    return callAI(messages, finalSystemPrompt);
}

module.exports = { analyzeModel, summarizeElements, chat };
