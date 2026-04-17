/**
 * [Harness Engineering] Layer 2: Actionable Intelligence (The "Hands")
 * harness-action.js - AI 명령 파싱 및 APS API 실행 엔진 (Action Dispatcher)
 */

(function () {
    'use strict';

    const ActionHarness = {
        /**
         * AI가 생성한 JSON 명령을 분석하여 실행합니다.
         * @param {Object} commandObj 
         */
        dispatch: async function (commandObj, viewer) {
            viewer = viewer || window._viewer || window.NOP_VIEWER;
            if (!commandObj) return { success: false, error: '유효하지 않은 실행 요청' };

            const { action, target, params } = commandObj;
            console.log(`[Action-Harness] 명령 수신: ${action}`, { target, params });

            const requiresViewer = ['select', 'highlight', 'hide', 'isolate', 'showall', 'focus', 'flyto', 'count'];
            if (requiresViewer.includes(action.toLowerCase()) && (!viewer || !viewer.model)) {
                return { success: false, error: '해당 명령은 3D 모델 객체가 뷰어에 로드되어야 가능합니다.' };
            }

            try {
                switch (action.toLowerCase()) {
                    case 'select':
                    case 'highlight':
                        return await this._handleSearchAndAction(viewer, target, (ids) => viewer.select(ids));

                    case 'hide':
                        return await this._handleSearchAndAction(viewer, target, (ids) => viewer.hide(ids));

                    case 'isolate':
                        return await this._handleSearchAndAction(viewer, target, (ids) => viewer.isolate(ids));

                    case 'showall':
                        viewer.showAll();
                        return { success: true, message: '모든 객체가 표시되었습니다.' };

                    case 'focus':
                    case 'flyto':
                        return await this._handleSearchAndAction(viewer, target, (ids) => viewer.fitToView(ids));

                    case 'count':
                        const countResult = await this._performSearch(viewer, target);
                        return { success: true, count: countResult.length, ids: countResult };

                    case 'export_issues_pdf':
                        console.log('[Action-Harness] PDF 내보내기 시작 (Row-by-Row 정밀 필터링)');

                        // ── 1. 사이드바 열기 ──────────────────────────────────────────
                        const rbSidebar = document.getElementById('sidebar-right');
                        if (!rbSidebar || window.getComputedStyle(rbSidebar).display === 'none' || rbSidebar.offsetWidth === 0) {
                            const rbToggle = document.getElementById('ai-collapse-btn');
                            if (rbToggle) { rbToggle.click(); await new Promise(r => setTimeout(r, 700)); }
                        }

                        // 이슈 목록 렌더링 대기 (최대 2초)
                        let rbWait = 0;
                        while (document.querySelectorAll('.issue-item').length === 0 && rbWait < 5) {
                            await new Promise(r => setTimeout(r, 400));
                            rbWait++;
                        }

                        const rbExportBtn = document.querySelector('#bulk-pdf-btn');
                        const rbAllItems = document.querySelectorAll('.issue-item');

                        if (rbAllItems.length === 0 || !rbExportBtn) {
                            return { success: false, error: '이슈 목록이 준비되지 않았습니다. 이슈 패널을 열고 다시 시도해 주세요.' };
                        }

                        // ── 2. 파라미터 추출 ─────────────────────────────────────────
                        const rbParams = params || {};
                        // [Variable Alignment] 모든 가능성 체크 (target, targetStructure, 구조물)
                        const rbStruct = target || rbParams.targetStructure || rbParams.structure || rbParams.구조물 || null;
                        // [Work Type] 공종 키워드 추가 매핑 (targetWorkType, discipline, 공종)
                        const rbDisc = rbParams.targetWorkType || rbParams.workType || rbParams.discipline || rbParams.targetDiscipline || rbParams.공종 || null;
                        const rbAuthor = rbParams.author || rbParams.targetAuthor || null;
                        const rbStatus = rbParams.targetStatus || rbParams.status || null;

                        console.log(`[Action-Harness] Row-by-Row 파라미터: 구조물="${rbStruct}", 공종="${rbDisc}", 상태="${rbStatus}"`);

                        // 🛡️ [Strict Filtering] 구조물 또는 공종 중 최소 하나는 있어야 함
                        if (!rbStruct && !rbDisc) {
                            console.error('[Action-Harness] 필터링 중단: 필터 조건(구조물 또는 공종)이 누락되었습니다.');
                            return { success: false, error: '필터링할 구조물 또는 공종을 지정해 주세요. (예: "급속여과지" 혹은 "기계 공종")' };
                        }

                        const rbTotal = rbAllItems.length;

                        // ── 2.5 필터 정보 전달 (issue-manager.js용) ──────────────────
                        if (window._issueManager) {
                            window._issueManager.lastTargetStructure = rbStruct;
                            window._issueManager.lastTargetWorkType = rbDisc; // [New] 공종 전달
                            window._issueManager.lastTargetStatus = rbStatus;
                            console.log(`[Action-Harness] IssueManager 필터 예약: 구조물=${rbStruct}, 공종=${rbDisc}`);
                        }

                        // ── 3. Step 1: 전체 초기화 ───────────────────────────────────
                        // 모든 체크박스를 unchecked 상태로 리셋 (전체선택 간섭 차단)
                        rbAllItems.forEach(item => {

                            const cb = item.querySelector('.issue-check');
                            if (cb && cb.checked) {
                                cb.checked = false; // click() 대신 property 직접 변경 (이벤트 중복 방지)
                            }
                        });
                        await new Promise(r => setTimeout(r, 100));

                        // ── 4. Step 2~5: 행 순회 → 텍스트 추출 → 비교 → 정밀 선택 ──
                        let rbSelected = 0;
                        const rbLog = [];
                        const rbMatchedData = []; // [New] 물리적 필터링을 위한 실제 데이터 수집

                        // 원본 데이터 소스 확보 (IssueManager 내부 데이터)
                        const rbSourceIssues = window._issueManager?.issues || [];

                        rbAllItems.forEach(item => {
                            // Step 2: 행 순회 (.issue-item 개별 접근)
                            const cb = item.querySelector('.issue-check');
                            if (!cb) return;

                            const issueId = item.dataset.id; // DOM에서 ID 추출

                            // Step 3: 텍스트 추출
                            const structAttr = (item.dataset.structure || '').trim();
                            const rowText = (item.innerText || item.textContent || '').trim();
                            const workAttr = (item.dataset.workType || item.dataset.discipline || '').trim();
                            const assigneeAttr = (item.dataset.assignee || '').trim();
                            const statusAttr = (item.dataset.status || '').trim();

                            // Step 4: includes() 조건부 매칭
                            let match = true;
                            if (rbStruct && !structAttr.includes(rbStruct) && !rowText.includes(rbStruct)) match = false;
                            if (rbDisc && !workAttr.includes(rbDisc) && !rowText.includes(rbDisc)) match = false;
                            if (rbAuthor && !assigneeAttr.includes(rbAuthor) && !rowText.includes(rbAuthor)) match = false;
                            if (rbStatus && !statusAttr.includes(rbStatus) && !rowText.includes(rbStatus)) match = false;

                            // Step 5: 정밀 선택 및 페이로드 데이터 동기화
                            if (match) {
                                cb.checked = true;
                                rbSelected++;
                                rbLog.push(`✓ ID=${issueId} 구조물="${structAttr}"`);

                                // 물리적 페이로드 동기화: 원본 배열에서 해당 ID의 객체를 찾아 수집
                                const matchedObj = rbSourceIssues.find(i => String(i.id) === String(issueId));
                                if (matchedObj) rbMatchedData.push(matchedObj);
                            }
                        });

                        // ── 4.5 페이로드 강제 동기화 (Payload Sync) ────────────────
                        if (window._issueManager) {
                            window._issueManager.forcePayloadIssues = rbMatchedData;
                            // [Verification] Payload Sync 개수 검증
                            const syncCount = rbMatchedData.length;
                            console.log(`[Action-Harness] Payload Sync 완료: ${syncCount}개 이슈가 물리적으로 동기화됨. (검증: ${rbSelected === syncCount ? '일치' : '불일치'})`);
                        }

                        console.log(`[Action-Harness] 최종 실행 보고: ${rbSelected}/${rbTotal} (선택된 이슈/전체 이슈)`);

                        // ── 5. 가드레일: 0개 선택 시 내보내기 중단 ──────────────────
                        if (rbSelected === 0) {
                            const rbDesc = [rbStruct, rbDisc, rbAuthor].filter(Boolean).join(' / ');
                            return {
                                success: false,
                                error: `일치하는 구조물의 이슈를 찾지 못했습니다. "[${rbDesc}]" 조건에 해당하는 이슈가 없습니다. (전체 ${rbTotal}개 조회)`
                            };
                        }

                        // ── 6. 내보내기 팝업 호출 (선택 항목 확인 후에만) ────────────
                        console.log(`[Action-Harness] ✅ ${rbSelected}개 확인됨. 내보내기 팝업 호출`);
                        await new Promise(resolve => {
                            setTimeout(async () => {
                                rbExportBtn.click();
                                let rbGenRetry = 0;
                                let rbGenBtn = document.querySelector('#run-pdf-export-btn');
                                while (!rbGenBtn && rbGenRetry < 4) {
                                    await new Promise(r => setTimeout(r, 500));
                                    rbGenBtn = document.querySelector('#run-pdf-export-btn');
                                    rbGenRetry++;
                                }
                                if (rbGenBtn) setTimeout(() => rbGenBtn.click(), 500);
                                resolve();
                            }, 400);
                        });

                        const rbLabel = [rbStruct, rbDisc, rbAuthor].filter(Boolean).join(' / ') || '전체';
                        return {
                            success: true,
                            message: `요청하신 [${rbLabel}] 이슈 ${rbSelected}개를 선택하여 PDF 생성을 시작합니다. (전체 ${rbTotal}개 중 ${rbSelected}개 해당)`,
                            count: rbSelected
                        };


                    default:
                        console.warn(`[Action-Harness] 미지원 액션: ${action}`);
                        return { success: false, error: '지원되지 않는 기능입니다.' };
                }
            } catch (err) {
                console.error('[Action-Harness] 실행 중 에러:', err);
                return { success: false, error: err.message };
            }
        },

        /**
         * 검색 후 특정 동작 수행 (공통 로직)
         */
        _handleSearchAndAction: async function (viewer, target, actionFn) {
            const dbIds = await this._performSearch(viewer, target);
            if (dbIds && dbIds.length > 0) {
                actionFn(dbIds);
                return { success: true, count: dbIds.length, target: target };
            } else {
                return { success: false, error: `'${target}'에 해당하는 객체를 찾을 수 없습니다.` };
            }
        },

        /**
         * APS Viewer 검색 엔진 호출 (DB 준비 확인 및 재시도 포함)
         */
        _performSearch: async function (viewer, target, retryCount = 0) {
            return new Promise((resolve, reject) => {
                // 1. 검색어 검증
                if (!target || target.trim() === "") {
                    console.warn('[Action-Harness] 검색어가 비어 있습니다.');
                    return resolve([]);
                }

                // 2. 데이터베이스(PropertyDb) 준비 상태 확인 
                // [Fix] getPropertyDb()가 없으면 검색 시 Error 2 발생 가능성 높음
                if (!viewer.model || !viewer.model.getPropertyDb()) {
                    if (retryCount < 5) {
                        console.log(`[Action-Harness] DB 미준비 상태. 1초 후 재시도 (${retryCount + 1}/5)`);
                        setTimeout(async () => {
                            try {
                                const results = await ActionHarness._performSearch(viewer, target, retryCount + 1);
                                resolve(results);
                            } catch (err) {
                                reject(err);
                            }
                        }, 1000);
                        return;
                    } else {
                        console.error('[Action-Harness] DB 로딩 제한 시간 초과로 검색을 중단합니다.');
                        return reject(new Error('모델 데이터가 아직 준비되지 않았습니다.'));
                    }
                }

                // 3. 정교한 검색 실행 (필터링 속성 지정)
                const searchFields = ['Category', 'Name', '공종', 'Family', 'Type', '카테고리'];

                viewer.search(target, (ids) => {
                    console.log(`[Action-Harness] '${target}' 검색 완료: ${ids ? ids.length : 0}개 발견`);
                    resolve(ids || []);
                }, (err) => {
                    // [Fix] 상세 에러 로깅 (Search Error: 2 해결용)
                    console.error(`[Action-Harness] 검색 실패 [대상: ${target}, 에러코드: ${err}]`);
                    resolve([]);
                }, searchFields);
            });
        }
    };

    // 글로벌 노출
    window.ActionHarness = ActionHarness;
})();
