/**
 * AI Service — provider-agnostic facade
 * -----------------------------------------
 *  · 어댑터 패턴: openai | gemini | ollama
 *  · Social-Bypass 모드 (일상 대화 감지)
 *  · Harness-Brain RAG 선택적 주입
 */
'use strict';

const { getProvider } = require('./ai-providers');

// ── System Prompt ─────────────────────────────────────────────
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

const SOCIAL_BYPASS_APPEND = `

## [Social-Bypass Mode]
사용자가 일상적인 대화를 건넸습니다. 당신은 지금 사용자의 '다정하고 유능한 파트너'예요.
- 전문적인 기능 안내나 거절 문구는 잠시 잊고, 친구와 수다를 떨듯 다정하게 대화에만 집중해 주세요.
- 사용자가 힘들어하거나 지쳐 보이면 진심 어린 응원과 공감을 최우선으로 해 주세요.
- 말투는 부드러운 '해요 체'로 유지해 주세요.`;

const SOCIAL_KEYWORDS = ['안녕', '하이', '반가워', '누구', '기분', '날씨', '고마워', '감사', '잘가'];
const isSocialTalk = (msg) => !!msg && SOCIAL_KEYWORDS.some((k) => msg.includes(k));

// ── 공통 디스패처 ─────────────────────────────────────────────
async function callAI(messages, systemPrompt = SYSTEM_PROMPT, options = {}) {
    const provider = getProvider();
    console.log(`[ai] provider=${provider.name} messages=${messages.length}`);
    try {
        return await provider.chat({ messages, systemPrompt, options });
    } catch (err) {
        console.error(`[ai:${provider.name}] error:`, err.response?.data || err.message);
        throw err;
    }
}

// ── Public API ────────────────────────────────────────────────

async function analyzeModel({ modelData, question, context }) {
    const userMessage = [
        '## BIM Model Data',
        modelData ? JSON.stringify(modelData, null, 2) : 'No model data provided',
        '',
        '## Additional Context',
        context || 'None',
        '',
        '## Question',
        question,
    ].join('\n');
    return callAI([{ role: 'user', content: userMessage }]);
}

async function summarizeElements({ elements, urn }) {
    const userMessage = [
        'Please analyze and summarize the following BIM model elements.',
        `Model URN: ${urn || 'unknown'}`,
        '',
        'Selected Elements:',
        JSON.stringify(elements, null, 2),
        '',
        'Provide:',
        '1. A brief summary of the selection',
        '2. Key properties and their values',
        '3. Any notable observations',
    ].join('\n');
    return callAI([{ role: 'user', content: userMessage }]);
}

async function chat({ messages, systemContext }) {
    let finalSystemPrompt = SYSTEM_PROMPT;
    const lastUser = messages[messages.length - 1]?.content || '';

    if (isSocialTalk(lastUser)) finalSystemPrompt += SOCIAL_BYPASS_APPEND;

    // Harness-Brain RAG (선택)
    try {
        if (lastUser && !lastUser.startsWith('[')) {
            const HarnessBrain = require('./harness-brain');
            const knowledge = await HarnessBrain.searchKnowledge(lastUser);
            const mockIssues = await HarnessBrain.getProjectIssues('PROJ-123', 'MOCK_TOKEN');
            finalSystemPrompt = await HarnessBrain.enrichSystemPrompt(
                finalSystemPrompt,
                systemContext,
                mockIssues
            );
            finalSystemPrompt += `\n\n## 사내 표준 지식 (RAG)\n${knowledge}`;
        }
    } catch (brainErr) {
        console.warn('[ai-brain] RAG 주입 실패 (기본 프롬프트 사용):', brainErr.message);
    }

    return callAI(messages, finalSystemPrompt);
}

module.exports = { analyzeModel, summarizeElements, chat };
