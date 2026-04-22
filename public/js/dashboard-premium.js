/* ============================================================
   Premium Dashboard Logic (ES6 Module)
   ============================================================ */

let allProjectsData = [];
let filteredProjects = [];
let chartCategoryInstance = null;
let chartLocationInstance = null;

// Categories & Locations for mock data generation
const MOCK_CATEGORIES = ['건축', '토목', '플랜트', '인프라'];
const MOCK_LOCATIONS = ['서울', '경기', '인천', '부산', '충청', '강원', '해외'];
const MOCK_STATUSES = ['진행중', '완료', '예정'];

/**
 * Main entry point to render the premium dashboard.
 * @param {Array} hubsData - Fetched hubs from API (optional)
 */
export async function renderPremiumDashboard(hubsData) {
    const gridContainer = document.getElementById('db-project-grid');
    if (!gridContainer) return;

    gridContainer.innerHTML = '<div style="padding:20px; color:var(--text-muted);"><i class="fas fa-spinner fa-spin"></i> 프로젝트 데이터를 불러오는 중...</div>';

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
                const projectsResponse = await fetch(`/api/hubs/${hub.id}/projects`);
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

    // 2. Enrich with Mock Data for Dashboard Features
    allProjectsData = fetchedProjects.map((p, index) => {
        // Deterministic mock generation based on index and name length for consistency across reloads
        const hash = p.name.length + index * 3;
        const status = MOCK_STATUSES[hash % MOCK_STATUSES.length];

        let dateObj = new Date(p.attributes?.createTime || p.created || Date.now());
        if (!p.created && !p.attributes?.createTime) {
            // Give some random old dates if no creation date exists
            dateObj = new Date(Date.now() - (hash * 1000000000));
        }

        return {
            ...p,
            mockCategory: MOCK_CATEGORIES[hash % MOCK_CATEGORIES.length],
            mockLocation: MOCK_LOCATIONS[(hash * 2) % MOCK_LOCATIONS.length],
            mockStatus: status,
            mockDate: dateObj,
            mockPeriod: `${dateObj.getFullYear()}.${String(dateObj.getMonth()+1).padStart(2,'0')} ~ ${status === '완료' ? (dateObj.getFullYear()+1)+'.12' : '진행중'}`,
            projectNum: p.id.slice(-8).toUpperCase()
        };
    });

    filteredProjects = [...allProjectsData];

    // 3. Initialize UI
    bindFilterEvents();
    applyFiltersAndSort(); // This will render cards, update stats, and draw charts
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
    if (sortSelect) sortSelect.addEventListener('change', updateTrigger);
}

/**
 * Core filtering and sorting logic.
 */
function applyFiltersAndSort() {
    const searchTerm = document.getElementById('db-search-input')?.value.toLowerCase() || '';
    const catVal = document.getElementById('filter-category')?.value || 'all';
    const locVal = document.getElementById('filter-location')?.value || 'all';
    const statusVal = document.getElementById('filter-status')?.value || 'all';
    const sortVal = document.getElementById('sort-projects')?.value || 'newest';

    filteredProjects = allProjectsData.filter(p => {
        const matchSearch = p.name.toLowerCase().includes(searchTerm) || p.projectNum.toLowerCase().includes(searchTerm);
        const matchCat = catVal === 'all' || p.mockCategory === catVal;
        const matchLoc = locVal === 'all' || p.mockLocation === locVal;
        const matchStatus = statusVal === 'all' || p.mockStatus === statusVal;

        return matchSearch && matchCat && matchLoc && matchStatus;
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
                <div class="meta-item"><i class="fas fa-hashtag"></i> <span>${p.projectNum}</span></div>
                <div class="meta-item"><i class="fas fa-tags"></i> <span>${p.mockCategory} 프로젝트</span></div>
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

    let total = allProjectsData.length;
    let active = allProjectsData.filter(p => p.mockStatus === '진행중').length;
    let completed = allProjectsData.filter(p => p.mockStatus === '완료').length;
    let planned = allProjectsData.filter(p => p.mockStatus === '예정').length;

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
    const ctxLoc = document.getElementById('chart-location');

    if (!ctxCat || !ctxLoc) return;

    // Aggregate data
    const catData = {};
    const locData = {};

    filteredProjects.forEach(p => {
        catData[p.mockCategory] = (catData[p.mockCategory] || 0) + 1;
        locData[p.mockLocation] = (locData[p.mockLocation] || 0) + 1;
    });

    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'right',
                labels: { color: '#94a3b8', font: {family: "'Inter', sans-serif", size: 11} }
            }
        }
    };

    // 1. Category Chart (Doughnut)
    if (chartCategoryInstance) chartCategoryInstance.destroy();
    chartCategoryInstance = new Chart(ctxCat.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: Object.keys(catData),
            datasets: [{
                data: Object.values(catData),
                backgroundColor: ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6'],
                borderWidth: 0,
                cutout: '65%'
            }]
        },
        options: commonOptions
    });

    // 2. Location Chart (Horizontal Bar)
    if (chartLocationInstance) chartLocationInstance.destroy();

    // Sort locations by count
    const sortedLocs = Object.keys(locData).sort((a,b) => locData[b] - locData[a]);
    const locValues = sortedLocs.map(k => locData[k]);

    chartLocationInstance = new Chart(ctxLoc.getContext('2d'), {
        type: 'bar',
        data: {
            labels: sortedLocs,
            datasets: [{
                label: '프로젝트 수',
                data: locValues,
                backgroundColor: 'rgba(99, 102, 241, 0.7)',
                borderColor: '#6366f1',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8', stepSize: 1 }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: '#94a3b8', font: {family: "'Inter', sans-serif"} }
                }
            }
        }
    });
}
