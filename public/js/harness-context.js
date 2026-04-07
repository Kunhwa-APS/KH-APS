/**
 * [Harness Engineering] Layer 1: Contextual Awareness (The "Eyes")
 * harness-context.js - APS Viewer 상태 인식 및 고성능 비동기 추출 엔진
 */

(function () {
    'use strict';

    const ContextHarness = {
        currentData: null,
        isExtracting: false,

        /**
         * 실시간 메타데이터를 추출합니다. 뷰어 객체가 없어도 이슈 데이터를 항상 최우선으로 가져옵니다.
         */
        extract: async function (viewer, retryCount = 0) {
            if (this.isExtracting && retryCount === 0) return;
            this.isExtracting = true;

            const modelData = {
                name: 'Project Dashboard',
                urn: 'none',
                categories: {},
                totalElements: 0,
                timestamp: new Date().toISOString(),
                issues: [],
                issueStructureCounts: {}
            };

            // [Viewer-Independent Architecture] 이슈 데이터는 모델 로드 여부와 무관하게 항상 수집
            console.log('[Context-Harness] 데이터 인식 엔진 가동: 이슈 데이터 수집 우선순위 적용');
            await this._fetchIssuesFromApi(modelData);

            // 1. 뷰어가 있고 모델이 로드된 경우 (3D 형상 데이터 보강)
            if (viewer && viewer.model) {
                const model = viewer.model;
                modelData.urn = model.getUrn ? model.getUrn() : (model.getData()?.urn || model.getSeedFile?.() || 'unknown-urn');

                try {
                    modelData.name = model.getData()?.loadOptions?.bubbleNode?.name?.() ||
                        model.getData()?.loadOptions?.bubbleNode?.name ||
                        'BIM Model';
                } catch (e) {
                    console.warn('[Context-Harness] 모델명 추출 실패:', e);
                }

                if (!model.isObjectTreeCreated()) {
                    viewer.addEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, () => {
                        this._performAsyncExtraction(viewer, modelData, retryCount);
                    }, { once: true });
                } else {
                    this._performAsyncExtraction(viewer, modelData, retryCount);
                }
            } else {
                // 2. 뷰어가 없거나 모델이 아직 없는 경우 (대시보드 또는 로딩 중)
                console.log('[Context-Harness] 모델 미로드 상태. 수집된 이슈 데이터만으로 컨텍스트를 구성합니다.');
                this._dispatchContext(modelData, true);
            }
        },

        /**
         * APS(ACC) Issues API에서 실시간 이슈 데이터를 페칭합니다.
         */
        _fetchIssuesFromApi: async function (modelData) {
            try {
                if (window.currentHubId && window.currentProjectId) {
                    console.log(`[Context-Harness] ACC Issues API 호출: Hub(${window.currentHubId}), Project(${window.currentProjectId})`);
                    const resp = await fetch(`/api/hubs/${window.currentHubId}/projects/${window.currentProjectId}/issues`);
                    if (resp.ok) {
                        const issuesData = await resp.json();
                        modelData.issues = issuesData;

                        const structureCounts = {};
                        issuesData.forEach(issue => {
                            const structName = issue.structure_name || '미분류';
                            const key = (structName.trim() !== '-' && structName.trim() !== '') ? structName : '미분류';
                            structureCounts[key] = (structureCounts[key] || 0) + 1;
                        });
                        modelData.issueStructureCounts = structureCounts;
                        console.log('[Context-Harness] API 이슈 데이터 전수 조사 완료:', JSON.stringify(structureCounts));
                    } else {
                        console.warn('[Context-Harness] API Fetch Failed:', resp.statusText);
                    }
                } else {
                    console.warn('[Context-Harness] ProjectId 또는 HubId 누락으로 이슈를 가져올 수 없습니다.');
                }
            } catch (err) {
                console.error('[Context-Harness] API 페치 예외 발생:', err);
            }
        },

        /**
         * 컨텍스트 업데이트 이벤트를 발송합니다.
         */
        _dispatchContext: function (modelData, isDashboard = false) {
            window.ContextHarness.currentData = modelData;
            window.ContextHarness.isExtracting = false;

            // AI 컨텍스트용 문자열 포맷팅
            let finalSummary = `## Model Metadata\nName: ${modelData.name}\nURN: ${modelData.urn}\nTotal Elements: ${modelData.totalElements}개\n`;

            if (!isDashboard && modelData.categories) {
                finalSummary += `\n## Categories\n`;
                for (const [catName, count] of Object.entries(modelData.categories)) {
                    finalSummary += `- ${catName}: ${count}개\n`;
                }
            }

            if (modelData.issueStructureCounts && Object.keys(modelData.issueStructureCounts).length > 0) {
                finalSummary += `\n## Issue Structure Analysis (JSON)\n${JSON.stringify(modelData.issueStructureCounts)}\n`;
            }

            const eventData = { ...modelData, summaryText: finalSummary };
            window.dispatchEvent(new CustomEvent('CONTEXT_HARNESS_UPDATED', { detail: eventData }));
            window.dispatchEvent(new CustomEvent('APS_MODEL_DATA_EXTRACTED', { detail: eventData }));

            if (window.AIPanel?.updateSystemContext) {
                window.AIPanel.updateSystemContext(eventData);
            }
        },

        /**
         * 비동기 하베스팅 및 배치 처리 수행
         */
        _performAsyncExtraction: async function (viewer, modelData, retryCount = 0) {
            try {
                const instanceTree = viewer.model.getInstanceTree();
                if (!instanceTree) {
                    this.isExtracting = false;
                    return;
                }

                const maxId = instanceTree.maxTreeId;
                const allDbIds = [];
                for (let i = 1; i <= maxId; i++) {
                    allDbIds.push(i);
                }

                console.log(`[Context-Harness] 3D 형상 전수 조사 대상 ID 수: ${allDbIds.length}개`);

                const BATCH_SIZE = 2500;
                const categories = {};

                for (let i = 0; i < allDbIds.length; i += BATCH_SIZE) {
                    const batch = allDbIds.slice(i, i + BATCH_SIZE);
                    await new Promise((resolve) => {
                        viewer.model.getBulkProperties(batch, { propFilter: ['Category', '카테고리'] }, (results) => {
                            results.forEach(res => {
                                const catProp = res.properties.find(p => p.displayName === 'Category' || p.attributeName === 'Category' || p.displayName === '카테고리');
                                if (catProp && catProp.displayValue) {
                                    const cleanCat = catProp.displayValue.toString().replace('Revit ', '').trim();
                                    if (cleanCat && !cleanCat.startsWith('<')) {
                                        categories[cleanCat] = (categories[cleanCat] || 0) + 1;
                                    }
                                }
                            });
                            resolve();
                        });
                    });
                    await new Promise(r => setTimeout(r, 0));
                }

                const totalFound = Object.values(categories).reduce((a, b) => a + b, 0);

                if (totalFound <= 2 && retryCount < 3) {
                    console.warn(`[Context-Harness] 3D 형상 추출 미흡(${totalFound}개). 재시도...`);
                    this.isExtracting = false;
                    setTimeout(() => this.extract(viewer, retryCount + 1), 1500);
                    return;
                }

                modelData.categories = categories;
                modelData.totalElements = totalFound;
                modelData.categoryList = Object.keys(categories).sort();

                // 3D 추출 완료 후 데이터 보강 (API 호출)
                await this._fetchIssuesFromApi(modelData);

                console.log(`[Context-Harness] 최종 인지 완료: 총 ${totalFound}개 객체, 이슈 ${modelData.issues?.length || 0}개`);
                this._dispatchContext(modelData, false);

            } catch (err) {
                console.error('[Context-Harness] 3D 형상 추출 실패:', err);
                this.isExtracting = false;
            }
        }
    };

    window.ContextHarness = ContextHarness;
})();
