/* ============================================================
   version-manager.js
   Manages the Version Selector and Version Management logic.
   ============================================================ */

import { loadModelWithTracking } from './viewer.js';

/**
 * Fetches version history for an item and populates the top-bar dropdown.
 */
export async function loadVersionsDropdown(hubId, projectId, itemId, currentVersionId) {
    // [NEW] 전역 상태 즉시 동기화 (오염 방지)
    window.currentItemId = itemId;
    window.currentUrn = currentVersionId; // URN으로 사용됨

    const versionBtn = document.getElementById('version-btn');
    const versionList = document.getElementById('version-list');
    const container = document.getElementById('version-selector-container');
    const currentText = document.getElementById('current-version-text');

    console.log('[VersionManager] Called with:', { hubId, projectId, itemId, currentVersionId });

    if (!versionBtn || !versionList || !container) {
        console.warn('[VersionManager] UI elements not found in DOM');
        return;
    }

    container.style.display = 'flex';
    if (currentText) currentText.textContent = 'Ver. ...';
    versionList.style.display = 'none';
    versionList.innerHTML = '<li class="version-loading">불러오는 중...</li>';
    versionBtn.classList.remove('open');

    // ── Dropdown Toggle Logic ──────────────────────────────────
    const toggleDropdown = (e) => {
        e.stopPropagation();
        const isOpen = versionList.style.display === 'block';
        versionList.style.display = isOpen ? 'none' : 'block';
        versionBtn.classList.toggle('open', !isOpen);
    };

    versionBtn.onclick = toggleDropdown;

    // Close on outside click
    const closeOnOutside = (e) => {
        if (!container.contains(e.target)) {
            versionList.style.display = 'none';
            versionBtn.classList.remove('open');
        }
    };
    document.removeEventListener('click', closeOnOutside);
    document.addEventListener('click', closeOnOutside);

    const url = `/api/hubs/${hubId}/projects/${projectId}/contents/${encodeURIComponent(itemId)}/versions?_t=${Date.now()}`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const versions = await response.json();
        if (!versions || versions.length === 0) {
            versionList.innerHTML = '<li class="version-loading">버전 정보 없음</li>';
            if (currentText) currentText.textContent = 'Ver. -';
            return;
        }

        versions.sort((a, b) => b.vNumber - a.vNumber);

        // [추가] 현재 로드된 URN을 기반으로 활성 버전 식별 (itemId 오참조 방지)
        const currentUrn = window.currentUrn;
        console.log('[VersionManager] Identifying active version by URN:', currentUrn);

        // Clear and populate
        versionList.innerHTML = '';
        versions.forEach(v => {
            const li = document.createElement('li');
            li.className = 'version-item';

            // URN 매칭 또는 ID 매칭 시도
            const isActive = (v.urn === currentUrn) || (v.id === currentVersionId);

            if (isActive) {
                li.classList.add('active');
                if (currentText) currentText.textContent = `V${v.vNumber}`;
            }

            const dateStr = new Date(v.name).toLocaleDateString('ko-KR', {
                year: 'numeric', month: '2-digit', day: '2-digit'
            });

            li.innerHTML = `
                <div class="v-num">V${v.vNumber}</div>
                <div class="v-date">${dateStr}</div>
                <div class="v-user">${v.displayName || 'Unknown'}</div>
            `;

            li.onclick = async () => {
                const urn = v.urn;
                const versionName = `${v.displayName} (V${v.vNumber})`;
                console.log(`[VersionManager] Switching to ${versionName} | URN: ${urn}`);

                // Close dropdown
                versionList.style.display = 'none';
                versionBtn.classList.remove('open');
                if (currentText) currentText.textContent = `V${v.vNumber}`;

                const loadingOverlay = document.getElementById('viewer-loading');
                if (loadingOverlay) loadingOverlay.style.display = 'flex';

                try {
                    if (window._viewer) {
                        // [추가] 현재 카메라 상태 저장
                        const savedState = window._viewer.getState({ viewport: true });
                        console.log('[VersionManager] Saved camera state before switch.');

                        // [CRITICAL] Clean Unload: Remove all existing models to prevent memory leaks/overlaps
                        const models = window._viewer.impl.modelQueue().getModels();
                        console.log(`[VersionManager] Unloading ${models.length} models...`);
                        models.forEach(m => window._viewer.impl.unloadModel(m));

                        // [추가] 신규 모델 로드 완료 시 카메라 상태 복원
                        const onGeometryLoaded = () => {
                            window._viewer.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, onGeometryLoaded);
                            console.log('[VersionManager] New model loaded, restoring camera state.');
                            window._viewer.restoreState(savedState, null, true); // true for immediate apply (or smooth)
                        };
                        window._viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, onGeometryLoaded);

                        // Load new model
                        await loadModelWithTracking(window._viewer, urn, versionName);

                        // Update UI
                        const modelLabel = document.getElementById('model-name-label');
                        if (modelLabel) modelLabel.textContent = versionName;
                        const topBarName = document.getElementById('viewer-model-name');
                        if (topBarName) topBarName.textContent = versionName;

                        // State Sync
                        window.currentUrn = urn;
                        window.currentItemId = itemId;

                        // URL Parameter Update
                        const newUrl = new URL(window.location.href);
                        newUrl.searchParams.set('urn', urn);
                        window.history.pushState({ urn }, '', newUrl);

                        // Refresh issues if manager exists
                        if (window._issueManager) {
                            window._issueManager.renderIssueList();
                            window._issueManager.restorePins();
                        }
                    }
                } catch (err) {
                    console.error('[VersionManager] Switch failed:', err);
                    alert('버전 전환 중 오류가 발생했습니다.');
                } finally {
                    if (loadingOverlay) loadingOverlay.style.display = 'none';
                }
            };
            versionList.appendChild(li);
        });

    } catch (err) {
        console.error('[VersionManager] Error loading versions:', err);
        versionList.innerHTML = `<li class="version-loading">오류: ${err.message}</li>`;
    }
}


/**
 * Legacy support / Optional modal
 */
export function openVersionModal(itemId, itemName) {
    if (window.explorer) {
        window.explorer.handleVersionClick(null, itemId, itemName);
    }
}
