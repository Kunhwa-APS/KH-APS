/* ============================================================
   Premium Dashboard Logic (ES6 Module)
   ============================================================ */

let allProjectsData = [];
let filteredProjects = [];
let chartCategoryInstance = null;
let chartLocationInstance = null;
let chartLocationTopInstance = null;
let chartYearInstance = null;
let chartStatusInstance = null;

// Categories & Locations for mock data generation
const MOCK_CATEGORIES = ['도로', '상하수도', '터널', '단지', '교량', '철도', 'Other'];
const MOCK_LOCATIONS = ['서울', '경기', '인천', '부산', '충청', '강원', '해외'];
const MOCK_STATUSES = ['진행중', '완료', '예정'];

/**
 * Map ACC HQ `type` (project type) to Korean category.
 * Returns null when type is empty/unknown so caller can fallback.
 */
/**
 * ACC `유형` (type) 필드 매핑 — 한글/영문 둘 다 지원.
 *
 *  한글 (ACC UI)              |  영문 (HQ API 반환값)               → 매핑
 *  ─────────────────────────────────────────────────────────────────
 *  데모프로젝트               |  Demonstration / Demo Project       → Demo
 *  레일                       |  Rail / Railway                     → 철도
 *  교통 시설                  |  Transportation Facilities          → 단지
 *  터널                       |  Tunnels                            → 터널
 *  브리지                     |  Bridges                            → 교량
 *  폐수 / 하수 / 상수도       |  Wastewater / Sewage / Water Supply → 상하수도
 *  거리 / 도로 / 고속도로     |  Streets / Roads / Highways         → 도로
 *  그 외                      |  —                                  → Other
 */
function mapCategoryFromType(type) {
    if (!type) return null;
    const raw = String(type).trim();
    const t = raw.toLowerCase();

    // Demonstration Project / 데모프로젝트 → Other (사용자 요청으로 Demo 카테고리 폐지)
    if (/데모/.test(raw) || /demonstration|demo/.test(t)) return 'Other';

    // Rail / Railway / 레일 → 철도 (일반 'transport' 매칭보다 먼저)
    if (/레일|철도/.test(raw) || /\brail(way|road)?\b|\brail\b/.test(t)) return '철도';

    // Transportation Facilities / 교통 시설 → 단지 (일반 '교통/transport' 매칭보다 먼저)
    if (/교통\s*시설/.test(raw) || /transportation/.test(t)) return '단지';

    // Tunnels / 터널 → 터널
    if (/터널/.test(raw) || /tunnel/.test(t)) return '터널';

    // Bridges / 브리지 → 교량
    if (/브리지|교량/.test(raw) || /bridge/.test(t)) return '교량';

    // Wastewater / Sewage / Water Supply / 폐수 / 하수 / 상수도 → 상하수도
    if (/폐수|하수|상수도|상하수도/.test(raw) || /wastewater|sewage|sewer|water\s*supply|water/.test(t)) return '상하수도';

    // Streets / Roads / Highways / 거리 / 교통 / 고속도로 → 도로
    if (/거리|도로|교통|고속도로/.test(raw) || /street|\broad(s|way)?\b|highway|transport/.test(t)) return '도로';

    // 그 외 모든 유형 → Other
    return 'Other';
}

/**
 * Map ACC HQ address (state/city/country) to Korean region label.
 * Returns null when address is empty/unknown.
 */
function mapLocationFromAddress(stateOrProvince, city, country, addressLine1, addressLine2) {
    // Scan every address-related field (HQ may populate only addressLine1 for manually-entered addresses)
    const src = [stateOrProvince, city, addressLine1, addressLine2].filter(Boolean).join(' ').trim();
    if (!src && !country) return null;

    const s = src.toLowerCase();
    const countryLc = (country || '').toLowerCase();

    // Korean region detection — check FIRST so "Korea, Republic of" country doesn't short-circuit
    if (/seoul|서울/.test(s)) return '서울';
    if (/gyeonggi|경기|수원|안산|성남|고양|용인|부천|안양|의정부|평택|시흥|화성|김포|남양주|광명|군포|하남|이천|오산/.test(s)) return '경기';
    if (/incheon|인천/.test(s)) return '인천';
    if (/busan|부산/.test(s)) return '부산';
    if (/chungcheong|chungbuk|chungnam|daejeon|sejong|충청|충북|충남|대전|세종/.test(s)) return '충청';
    if (/gangwon|강원/.test(s)) return '강원';
    if (/gyeongsang|gyeongbuk|gyeongnam|daegu|ulsan|경상|경북|경남|대구|울산/.test(s)) return '경상';
    if (/jeolla|jeonbuk|jeonnam|gwangju|전라|전북|전남|광주|군산|전주|익산|여수|순천/.test(s)) return '전라';
    if (/jeju|제주/.test(s)) return '제주';

    // Outside Korea → 해외
    const koreaTokens = /korea|대한민국|한국|republic of korea|^kr$/i;
    if (country && !koreaTokens.test(countryLc)) return '해외';

    return src ? '해외' : null;
}

/**
 * Map ACC HQ `status` (+ end date) to Korean status label.
 */
function mapStatusFromACC(status, endDate) {
    if (!status) return null;
    const s = String(status).toLowerCase();
    if (/archived|completed|closed/.test(s)) return '완료';
    if (/pending|suspended|template/.test(s)) return '예정';
    if (/active|in[\s_-]*progress|ongoing/.test(s)) {
        // If end date passed, treat as 완료
        if (endDate) {
            const ed = new Date(endDate);
            if (!isNaN(ed.getTime()) && ed < new Date()) return '완료';
        }
        return '진행중';
    }
    return null;
}

/**
 * Main entry point to render the premium dashboard.
 * @param {Array} hubsData - Fetched hubs from API (optional)
 */
export async function renderPremiumDashboard(hubsData, { refresh = false } = {}) {
    const gridContainer = document.getElementById('db-project-grid');
    if (!gridContainer) return;

    gridContainer.innerHTML = '<div style="padding:20px; color:var(--text-muted);"><i class="fas fa-spinner fa-spin"></i> 프로젝트 데이터를 불러오는 중...</div>';

    // Remember for the refresh button
    window._lastDashboardHubs = hubsData;

    // 1. Fetch Hubs if not provided
    if (!hubsData || hubsData.length === 0) {
        try {
            const hubsResponse = await fetch('/api/hubs');
            hubsData = await hubsResponse.json();
        } catch(e) {
            console.error('Failed to fetch hubs:', e);
            hubsData = [];
        }
    }

    // 2. Fetch Projects for all Hubs
    let fetchedProjects = [];
    try {
        const projectPromises = hubsData.map(async (hub) => {
            try {
                const projectsResponse = await fetch(`/api/hubs/${hub.id}/projects${refresh ? '?refresh=1' : ''}`);
                const projects = await projectsResponse.json();
                return projects.map(p => ({ ...p, hubName: hub.name, hubId: hub.id }));
            } catch (err) {
                console.warn(`Failed to fetch projects for hub ${hub.id}:`, err);
                return [];
            }
        });

        const results = await Promise.all(projectPromises);
        fetchedProjects = results.flat();
    } catch (err) {
        gridContainer.innerHTML = '<div style="color:var(--accent-red); padding: 20px;">프로젝트 목록을 불러오는 중 오류가 발생했습니다.</div>';
        return;
    }

    if (fetchedProjects.length === 0) {
        gridContainer.innerHTML = '<div style="padding:20px; color:var(--text-muted);">참여 중인 프로젝트가 없습니다.</div>';
        return;
    }

    // 2. Enrich with ACC/Forma project metadata (real values when present, fallback to deterministic mock)
    allProjectsData = fetchedProjects.map((p, index) => {
        const hash = p.name.length + index * 3;
        const fallbackStatus = MOCK_STATUSES[hash % MOCK_STATUSES.length];

        // Date: prefer HQ start_date, then createTime
        const dateSrc = p.startDate || p.attributes?.createTime || p.createdAt || null;
        let dateObj = dateSrc ? new Date(dateSrc) : new Date(Date.now() - (hash * 1000000000));
        if (isNaN(dateObj.getTime())) dateObj = new Date();

        // ACC '유형' 필드만 사용 (이름 기반 추측 없음)
        const realCategory = mapCategoryFromType(p.projectType) || 'Other';
        const realLocation = mapLocationFromAddress(p.stateOrProvince, p.city, p.country, p.addressLine1, p.addressLine2);
        const realStatus = mapStatusFromACC(p.projectStatus, p.endDate);

        // Debug: dump raw ACC fields so we can see why mapping fell through
        console.debug(`[proj] "${p.name}" | type="${p.projectType || ''}" | state="${p.stateOrProvince || ''}" | city="${p.city || ''}" | addr1="${p.addressLine1 || ''}" | country="${p.country || ''}" | →cat=${realCategory || 'MISS'} →loc=${realLocation || 'MISS'}`);

        const category = realCategory || MOCK_CATEGORIES[hash % MOCK_CATEGORIES.length];
        const location = realLocation || MOCK_LOCATIONS[(hash * 2) % MOCK_LOCATIONS.length];
        const status = realStatus || fallbackStatus;

        const startStr = `${dateObj.getFullYear()}.${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
        let endStr = '진행중';
        if (p.endDate) {
            const ed = new Date(p.endDate);
            if (!isNaN(ed.getTime())) endStr = `${ed.getFullYear()}.${String(ed.getMonth() + 1).padStart(2, '0')}`;
        } else if (status === '완료') {
            endStr = `${dateObj.getFullYear() + 1}.12`;
        }

        return {
            ...p,
            mockCategory: category,
            mockLocation: location,
            mockStatus: status,
            mockDate: dateObj,
            mockStartDate: dateObj.toISOString().slice(0, 10),
            mockPeriod: `${startStr} ~ ${endStr}`,
            projectNum: (p.jobNumber && String(p.jobNumber).trim()) || '',
            // Track provenance for debugging/UI badges
            _sourceCategory: realCategory ? 'acc' : 'mock',
            _sourceLocation: realLocation ? 'acc' : 'mock',
            _sourceStatus: realStatus ? 'acc' : 'mock',
        };
    });

    filteredProjects = [...allProjectsData];

    // Populate year filter options from available project data
    populateYearFilter();

    // 3. Initialize UI
    bindFilterEvents();
    applyFiltersAndSort(); // This will render cards, update stats, and draw charts
}

function populateYearFilter() {
    const sel = document.getElementById('filter-year');
    if (!sel) return;
    const years = [...new Set(allProjectsData
        .map(p => (p.mockStartDate || '').slice(0, 4))
        .filter(y => y)
    )].sort((a, b) => b.localeCompare(a));
    // Preserve 'all' option and refill
    sel.innerHTML = '<option value="all">전체 연도</option>' +
        years.map(y => `<option value="${y}">${y}년</option>`).join('');
}

/**
 * Bind event listeners to filter inputs.
 */
function bindFilterEvents() {
    const searchInput = document.getElementById('db-search-input');
    const filterCat = document.getElementById('filter-category');
    const filterLoc = document.getElementById('filter-location');
    const filterStatus = document.getElementById('filter-status');
    const sortSelect = document.getElementById('sort-projects');

    const updateTrigger = () => applyFiltersAndSort();

    if (searchInput) searchInput.addEventListener('input', updateTrigger);
    if (filterCat) filterCat.addEventListener('change', updateTrigger);
    if (filterLoc) filterLoc.addEventListener('change', updateTrigger);
    if (filterStatus) filterStatus.addEventListener('change', updateTrigger);
    const filterYear = document.getElementById('filter-year');
    if (filterYear) filterYear.addEventListener('change', updateTrigger);
    if (sortSelect) sortSelect.addEventListener('change', updateTrigger);

    // Refresh button — bypass server cache and re-fetch from ACC
    const refreshBtn = document.getElementById('db-refresh-btn');
    if (refreshBtn && !refreshBtn._bound) {
        refreshBtn._bound = true;
        refreshBtn.addEventListener('click', async () => {
            if (refreshBtn._loading) return;
            refreshBtn._loading = true;
            refreshBtn.classList.add('loading');
            const icon = refreshBtn.querySelector('i');
            if (icon) icon.classList.add('fa-spin');
            try {
                await renderPremiumDashboard(window._lastDashboardHubs, { refresh: true });
            } catch (e) {
                console.error('Refresh failed:', e);
            } finally {
                refreshBtn._loading = false;
                refreshBtn.classList.remove('loading');
                if (icon) icon.classList.remove('fa-spin');
            }
        });
    }
}

/**
 * Core filtering and sorting logic.
 */
function applyFiltersAndSort() {
    const searchTerm = document.getElementById('db-search-input')?.value.toLowerCase() || '';
    const catVal = document.getElementById('filter-category')?.value || 'all';
    const locVal = document.getElementById('filter-location')?.value || 'all';
    const statusVal = document.getElementById('filter-status')?.value || 'all';
    const yearVal = document.getElementById('filter-year')?.value || 'all';
    const sortVal = document.getElementById('sort-projects')?.value || 'newest';

    filteredProjects = allProjectsData.filter(p => {
        const matchSearch = p.name.toLowerCase().includes(searchTerm) || (p.projectNum || '').toLowerCase().includes(searchTerm);
        const matchCat = catVal === 'all' || p.mockCategory === catVal;
        const matchLoc = locVal === 'all' || p.mockLocation === locVal;
        const matchStatus = statusVal === 'all' || p.mockStatus === statusVal;
        const matchYear = yearVal === 'all' || (p.mockStartDate || '').startsWith(yearVal);

        return matchSearch && matchCat && matchLoc && matchStatus && matchYear;
    });

    // Sorting
    filteredProjects.sort((a, b) => {
        if (sortVal === 'newest') return b.mockDate - a.mockDate;
        if (sortVal === 'oldest') return a.mockDate - b.mockDate;
        if (sortVal === 'name') return a.name.localeCompare(b.name);
        return 0;
    });

    renderCards();
    updateStats();
    updateCharts();
}

/**
 * Render HTML for project cards.
 */
function renderCards() {
    const grid = document.getElementById('db-project-grid');
    const countEl = document.getElementById('db-project-count');
    if (!grid) return;

    if (countEl) countEl.textContent = filteredProjects.length;

    grid.innerHTML = '';

    if (filteredProjects.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--text-muted);">조건에 맞는 프로젝트가 없습니다.</div>';
        return;
    }

    filteredProjects.forEach(p => {
        const card = document.createElement('div');
        card.className = 'db-project-card';

        let statusClass = 'planned';
        if (p.mockStatus === '진행중') statusClass = 'active';
        else if (p.mockStatus === '완료') statusClass = 'completed';

        card.innerHTML = `
            <div class="card-header">
                <div class="card-title" title="${p.name}">${p.name}</div>
                <span class="badge-status ${statusClass}">${p.mockStatus}</span>
            </div>
            <div class="card-meta">
                ${p.projectNum ? `<div class="meta-item" title="프로젝트 번호"><i class="fas fa-hashtag"></i> <span>${p.projectNum}</span></div>` : ''}
                <div class="meta-item"><i class="fas fa-tags"></i> <span>${p.mockCategory}</span></div>
                <div class="meta-item"><i class="fas fa-map-marker-alt"></i> <span>${p.mockLocation}</span></div>
                <div class="meta-item"><i class="far fa-calendar-alt"></i> <span>${p.mockPeriod}</span></div>
            </div>
            <div class="card-footer">
                <span class="card-hub"><i class="fas fa-server"></i> ${p.hubName}</span>
                <span class="card-action"><i class="fas fa-arrow-right"></i></span>
            </div>
        `;

        // Click handler to load project into explorer/viewer
        card.addEventListener('click', () => handleProjectClick(p));
        grid.appendChild(card);
    });
}

/**
 * Handle card click -> Navigate to project folder
 */
async function handleProjectClick(project) {
    console.log('[Dashboard Premium] Card Clicked:', project.name);

    // Hide dashboard
    document.getElementById('dashboard-premium-container').style.display = 'none';

    // Set global context
    window.currentHubId = project.hubId;
    window.currentProjectId = project.id;
    localStorage.setItem('aps_last_hub_id', project.hubId);
    localStorage.setItem('aps_last_project_id', project.id);

    if (window.ContextHarness) {
        window.ContextHarness.extract(null);
    }

    if (window.explorer) {
        window.explorer.switchMode('explorer');

        try {
            const resp = await fetch(`/api/hubs/${project.hubId}/projects/${project.id}/contents`);
            if (resp.ok) {
                const items = await resp.json();
                const pf = items.find(i => i.folder && i.name.toLowerCase().includes('project files'));
                if (pf) {
                    window.explorer.showFolder(project.hubId, project.id, pf.id, pf.name);
                    return;
                }
            }
        } catch (err) {
            console.warn('[Dashboard] Fallback navigation:', err);
        }

        window.explorer.showFolder(project.hubId, project.id, null, project.name);
    }
}

/**
 * Update top-level statistics numbers.
 */
function updateStats() {
    const elTotal = document.getElementById('stat-total');
    const elActive = document.getElementById('stat-active');
    const elCompleted = document.getElementById('stat-completed');
    const elPlanned = document.getElementById('stat-planned');

    if (!elTotal) return;

    // 필터(카테고리/위치/연도/상태) 적용 결과 기준으로 카운트
    const source = (filteredProjects && filteredProjects.length !== undefined)
        ? filteredProjects
        : allProjectsData;
    let total = source.length;
    let active = source.filter(p => p.mockStatus === '진행중').length;
    let completed = source.filter(p => p.mockStatus === '완료').length;
    let planned = source.filter(p => p.mockStatus === '예정').length;

    // Animate numbers
    animateValue(elTotal, 0, total, 500);
    animateValue(elActive, 0, active, 500);
    animateValue(elCompleted, 0, completed, 500);
    animateValue(elPlanned, 0, planned, 500);
}

function animateValue(obj, start, end, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * (end - start) + start);
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}

/**
 * Draw/Update Chart.js visualizations based on the filtered data
 */
function updateCharts() {
    if (typeof Chart === 'undefined') return;

    const ctxCat = document.getElementById('chart-category');
    const ctxLocTop = document.getElementById('chart-location-top');
    const ctxYear = document.getElementById('chart-year');
    const ctxStatus = document.getElementById('chart-status');
    const ctxLoc = document.getElementById('chart-location');

    // Aggregate data
    const catData = {};
    const locData = {};
    const yearData = {};
    const statusData = {};

    filteredProjects.forEach(p => {
        catData[p.mockCategory] = (catData[p.mockCategory] || 0) + 1;
        locData[p.mockLocation] = (locData[p.mockLocation] || 0) + 1;
        const y = (p.mockStartDate || '').slice(0, 4);
        if (y) yearData[y] = (yearData[y] || 0) + 1;
        if (p.mockStatus) statusData[p.mockStatus] = (statusData[p.mockStatus] || 0) + 1;
    });

    const axisTicks = { color: '#94a3b8', font: { family: "'Inter', sans-serif", size: 10 } };
    const donutLegend = {
        responsive: true, maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'bottom',
                align: 'center',
                labels: {
                    color: '#94a3b8',
                    font: { size: 10 },
                    boxWidth: 10,
                    generateLabels: (chart) => {
                        const data = chart.data;
                        if (!data.labels?.length) return [];
                        const ds = data.datasets[0];
                        return data.labels.map((label, i) => ({
                            text: `${label} (${ds.data[i]})`,
                            fillStyle: Array.isArray(ds.backgroundColor) ? ds.backgroundColor[i] : ds.backgroundColor,
                            strokeStyle: 'transparent',
                            lineWidth: 0,
                            fontColor: '#e5e7eb',
                            hidden: false,
                            index: i,
                        }));
                    }
                }
            },
            tooltip: {
                callbacks: {
                    label: (ctx) => ` ${ctx.label}: ${ctx.parsed}개`
                }
            }
        }
    };
    const integerTicks = { ...axisTicks, stepSize: 1, precision: 0, callback: (v) => Number.isInteger(v) ? v : null };
    const barOpts = {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
            x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: axisTicks, beginAtZero: true },
            y: { grid: { display: false }, ticks: axisTicks, beginAtZero: true }
        }
    };
    // Vertical bar (count on Y-axis) → integer Y ticks
    const vBarOpts = {
        ...barOpts,
        scales: {
            x: { grid: { display: false }, ticks: axisTicks },
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: integerTicks, beginAtZero: true }
        }
    };
    // Horizontal bar (count on X-axis) → integer X ticks
    const hBarOpts = {
        ...barOpts,
        indexAxis: 'y',
        scales: {
            x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: integerTicks, beginAtZero: true },
            y: { grid: { display: false }, ticks: axisTicks }
        }
    };

    // 1. Category (Doughnut) - top row
    if (ctxCat) {
        if (chartCategoryInstance) chartCategoryInstance.destroy();
        // Fixed display order
        const CAT_ORDER = ['상하수도', '도로', '단지', '터널', '교량', '철도', 'Other'];
        const CAT_COLORS = {
            '도로': '#10b981',
            '상하수도': '#0ea5e9',
            '터널': '#22d3ee',
            '단지': '#a855f7',
            '교량': '#06b6d4',
            '철도': '#f59e0b',
            'Other': '#6366f1',
        };
        const sortedCats = Object.keys(catData).sort((a, b) => {
            const ia = CAT_ORDER.indexOf(a);
            const ib = CAT_ORDER.indexOf(b);
            return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        });
        chartCategoryInstance = new Chart(ctxCat.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: sortedCats,
                datasets: [{
                    data: sortedCats.map(k => catData[k]),
                    backgroundColor: sortedCats.map(k => CAT_COLORS[k] || '#6366f1'),
                    borderWidth: 0,
                    cutout: '60%'
                }]
            },
            options: donutLegend
        });
    }

    // 2. Location (small horizontal bar) - top row
    if (ctxLocTop) {
        if (chartLocationTopInstance) chartLocationTopInstance.destroy();
        // Fixed display order: 서울 > 경기 > 인천 > 충청 > 강원 > 경상 > 전라 > 부산 > 제주 > 해외
        const LOC_ORDER = ['서울', '경기', '인천', '전라', '경상', '부산', '충청', '강원', '제주', '해외'];
        const sortedLocs = Object.keys(locData).sort((a, b) => {
            const ia = LOC_ORDER.indexOf(a);
            const ib = LOC_ORDER.indexOf(b);
            return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        });
        chartLocationTopInstance = new Chart(ctxLocTop.getContext('2d'), {
            type: 'bar',
            data: {
                labels: sortedLocs,
                datasets: [{ data: sortedLocs.map(k => locData[k]), backgroundColor: 'rgba(14, 165, 233, 0.7)', borderColor: '#0ea5e9', borderWidth: 1, borderRadius: 4 }]
            },
            options: hBarOpts
        });
    }

    // 3. Year Distribution (vertical bar) - top row
    if (ctxYear) {
        if (chartYearInstance) chartYearInstance.destroy();
        const sortedYears = Object.keys(yearData).sort();
        chartYearInstance = new Chart(ctxYear.getContext('2d'), {
            type: 'bar',
            data: {
                labels: sortedYears,
                datasets: [{ data: sortedYears.map(k => yearData[k]), backgroundColor: 'rgba(16, 185, 129, 0.7)', borderColor: '#10b981', borderWidth: 1, borderRadius: 4 }]
            },
            options: vBarOpts
        });
    }

    // 4. Status Distribution is now shown as a 2x2 KPI grid (no chart needed)

}
