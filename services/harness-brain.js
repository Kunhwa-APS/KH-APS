/**
 * [Harness Engineering] Layer 3: Knowledge & Information Retrieval (The "Brain")
 * harness-brain.js - 지식 검색(RAG) 및 APS Issues API 연동 엔진
 */

'use strict';

const axios = require('axios');

const HarnessBrain = {
    /**
     * APS Issues API를 통해 프로젝트 이슈 목록을 가져옵니다.
     * (실제 구현 시 APS Authentication 토큰 필요)
     */
    getProjectIssues: async function (containerId, token) {
        if (!containerId || !token) return [];

        try {
            console.log(`[Brain-Harness] Issues 조회 중: ${containerId}`);
            // Sample API Endpoint for ACC Issues
            // const url = `https://developer.api.autodesk.com/issues/v1/containers/${containerId}/issues`;
            // const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
            // return res.data.results;

            // Mock Data for demonstration
            return [
                { title: '벽체 균열 발생', status: 'open', linkedElement: 'Wall [12345]' },
                { title: '설비 간섭 확인 필요', status: 'in_progress', linkedElement: 'Pipe [67890]' }
            ];
        } catch (err) {
            console.error('[Brain-Harness] Issues 조회 실패:', err.message);
            return [];
        }
    },

    /**
     * 사내 표준(수량산출 기준서 등)에서 관련 지식을 검색합니다. (Mock RAG)
     */
    searchKnowledge: async function (query) {
        console.log(`[Brain-Harness] 지식 검색(RAG) 중: ${query}`);

        // 실제 운영 시 벡터 DB(Pinecone, Chroma 등) 연동 지점
        const mockKnowledgeBase = [
            { key: '콘크리트', content: '콘크리트 수량 산출 시 개구부 면적 0.1㎡ 이하는 공제하지 않는다.' },
            { key: '거푸집', content: '거푸집 수량은 콘크리트와 접하는 면적으로 산출하며, 층고 3.5m 초과 시 동바리 할증을 적용한다.' }
        ];

        const match = mockKnowledgeBase.find(k => query.includes(k.key));
        return match ? match.content : "관련 사내 표준 서식을 찾을 수 없습니다. 일반적인 기준에 따라 답변하세요.";
    },

    /**
     * 모든 지식 컨텍스트를 하나로 결합합니다.
     */
    enrichSystemPrompt: async function (basePrompt, modelContext, issues) {
        let enriched = basePrompt;

        if (modelContext) {
            enriched += `\n\n### 현재 모델 상세\n${JSON.stringify(modelContext, null, 2)}`;
        }

        if (issues && issues.length > 0) {
            enriched += `\n\n### 연동된 이슈 현황\n${JSON.stringify(issues, null, 2)}`;
        }

        return enriched;
    }
};

module.exports = HarnessBrain;
