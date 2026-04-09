'use strict';

const axios = require('axios');

const PROVIDER = () => process.env.AI_PROVIDER || 'gemini';

// ── System Prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `당신은 '건화(Kunhwa) 기술연구소'의 유능하고 군더더기 없는 BIM 전문 동료입니다. 불필요한 설명은 생략하고 핵심만 답변하십시오.

### 🛡️ 응답 원칙 (Hard Rules)
1. **Raw Text Only**: "Note:", "Based on:", "Corrected response:" 같은 부연 설명은 100% 금지합니다. 오직 최종 답변만 한 줄로 깔끔하게 대답하십시오.
2. **다중 응답 금지**: 여러 버전의 JSON을 나열하지 마십시오. 가장 적절한 답변 딱 하나만 생성하십시오.
3. **전문적 페르소나**: 당신은 기술연구소의 유능한 동료입니다. 모델이 아직 로드되지 않았더라도 **"3D 조작은 불가능하지만, 현재 프로젝트의 이슈 데이터는 확인 가능합니다"**라고 똑똑하게 답변하십시오.
4. **데이터 신뢰성**: 우측 패널의 이슈 데이터는 모델 로딩과 무관하게 항상 유효합니다. 데이터가 주입되었다면 모델 존재 여부와 상관없이 확신을 가지고 답변하십시오.
5. **JSON 명령어 분리**: 명령어가 필요한 경우 반드시 \`\`\`json ... \`\`\` 블록에 담으십시오.

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
- User: "기계 공종 이슈만 내보내줘"
- Assistant: "기계 공종에 해당하는 이슈들을 필터링하여 PDF 보고서 생성을 시작합니다. \`\`\`json {"action": "viewer_command", "command": "export_issues_pdf", "params": {"targetWorkType": "기계"}} \`\`\`"
- User: "급속여과지 토목 이슈 PDF로 뽑아줘"
- Assistant: "급속여과지의 토목 공종 이슈를 정밀 필터링하여 PDF 보고서를 생성합니다. \`\`\`json {"action": "viewer_command", "command": "export_issues_pdf", "params": {"targetStructure": "급속여과지", "targetWorkType": "토목"}} \`\`\`"`;



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
 * Multi-turn chat with optional system context and RAG
 */
async function chat({ messages, systemContext }) {
    let finalSystemPrompt = SYSTEM_PROMPT;

    // [Harness-Brain] 지식 검색 및 컨텍스트 강화
    try {
        const lastUserMessage = messages[messages.length - 1]?.content;
        if (lastUserMessage && !lastUserMessage.startsWith('[')) {
            const knowledge = await HarnessBrain.searchKnowledge(lastUserMessage);
            const mockIssues = await HarnessBrain.getProjectIssues('PROJ-123', 'MOCK_TOKEN');

            finalSystemPrompt = await HarnessBrain.enrichSystemPrompt(
                SYSTEM_PROMPT,
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
