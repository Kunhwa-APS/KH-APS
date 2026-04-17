import { initViewer, loadModel } from './viewer.js';
import { initTree } from './sidebar.js';
import { initMap, addProjectMarkers, flyToLocation, resizeMap } from './map.js';

const login = document.getElementById('login');
let apsViewer = null;
let mapInitialized = false;
let mapApiKey = null;

// ── 탭 전환 (전역) ──
window.switchTab = async function(tab) {
    document.getElementById('tab-viewer').classList.toggle('active', tab === 'viewer');
    document.getElementById('tab-map').classList.toggle('active', tab === 'map');
    document.getElementById('preview').style.display = tab === 'viewer' ? 'block' : 'none';
    document.getElementById('map-container').style.display = tab === 'map' ? 'block' : 'none';

    // Map 탭 클릭 시 처음 한 번만 초기화 (Lazy Init - display:none 문제 해결)
    if (tab === 'map' && !mapInitialized && mapApiKey) {
        try {
            await initMap('map-container', mapApiKey);
            mapInitialized = true;
            // 로그인 상태면 허브 마커 표시
            if (login.innerText.startsWith('Logout')) {
                await loadHubsOnMap();
            }
        } catch (err) {
            console.error('Google Maps init error:', err);
            document.getElementById('map-container').innerHTML = `
                <div style="display:flex;align-items:center;justify-content:center;height:100%;color:#94a3b8;font-family:Inter,sans-serif;flex-direction:column;gap:12px;">
                    <div style="font-size:48px;">🗺️</div>
                    <div style="font-size:16px;font-weight:600;color:#f1f5f9;">Google Maps 로드 실패</div>
                    <div style="font-size:13px;max-width:400px;text-align:center;line-height:1.6;">
                        Google Cloud Console에서 <strong>Maps JavaScript API</strong>를 활성화하고 API 키에 <strong>HTTP 참조자 제한</strong>이 없는지 확인하세요.
                    </div>
                </div>
            `;
        }
    } else if (tab === 'map' && mapInitialized) {
        setTimeout(() => resizeMap(), 100);
    }
};

// ── Google Maps API 키 미리 로드 ──
try {
    const cfgResp = await fetch('/api/config/maps');
    if (cfgResp.ok) {
        const cfg = await cfgResp.json();
        mapApiKey = cfg.apiKey;
    } else {
        console.warn('Google Maps API key not configured.');
        document.getElementById('tab-map').disabled = true;
        document.getElementById('tab-map').title = '.env에 GOOGLE_MAPS_API_KEY 입력 필요';
    }
} catch (err) {
    console.warn('Could not load maps config:', err.message);
}

// ── APS 인증 상태 확인 ──
try {
    const resp = await fetch('/api/auth/profile');
    if (resp.ok) {
        const user = await resp.json();
        login.innerText = `Logout (${user.name})`;
        login.onclick = () => {
            const iframe = document.createElement('iframe');
            iframe.style.visibility = 'hidden';
            iframe.src = 'https://accounts.autodesk.com/Authentication/LogOut';
            document.body.appendChild(iframe);
            iframe.onload = () => {
                window.location.replace('/api/auth/logout');
                document.body.removeChild(iframe);
            };
        };

        // APS Viewer 초기화
        apsViewer = await initViewer(document.getElementById('preview'));

        // 트리 사이드바 초기화
        initTree('#tree', (versionId) => {
            loadModel(apsViewer, window.btoa(versionId).replace(/=/g, ''));
            window.switchTab('viewer');
        });

    } else {
        login.innerText = 'Login';
        login.onclick = () => window.location.replace('/api/auth/login');
    }
    login.style.visibility = 'visible';
} catch (err) {
    alert('앱 초기화 오류. 콘솔을 확인해주세요.');
    console.error(err);
}

// ── ACC 허브 프로젝트를 지도에 마커로 표시 ──
async function loadHubsOnMap() {
    try {
        const hubs = await fetch('/api/hubs').then(r => r.json());
        const allProjects = [];

        for (const hub of hubs) {
            if (!hub.id) continue;
            const projects = await fetch(`/api/hubs/${hub.id}/projects`).then(r => r.json());

            // 각 프로젝트의 주소를 VWorld 지오코딩으로 변환
            for (const p of projects) {
                let lat = p.latitude ? parseFloat(p.latitude) : null;
                let lng = p.longitude ? parseFloat(p.longitude) : null;
                let address = '';
                let hasRealLocation = !!(lat && lng);

                // ACC 직접 위경도가 없으면 주소로 지오코딩
                if (!hasRealLocation) {
                    // 한국 VWorld→Nominatim 지오코딩: 정밀도 높은 순서로 시도
                    const street = [p.addressLine1, p.addressLine2].filter(Boolean).join('');
                    const candidates = [
                        [p.stateOrProvince, p.city, street].filter(Boolean).join(' '),         // 경기도 남양주시 고산로171
                        [p.stateOrProvince, p.city, p.addressLine1].filter(Boolean).join(' '), // 경기도 남양주시 고산로
                        [p.stateOrProvince, p.city].filter(Boolean).join(' '),                 // 경기도 남양주시
                        p.postalCode || '',                                                    // 12245 (우편번호)
                        p.city || '',                                                          // 남양주시
                    ].filter(Boolean);

                    for (const candidate of candidates) {
                        try {
                            const params = new URLSearchParams({ address: candidate });
                            if (candidate === p.postalCode) params.set('postalCode', p.postalCode);
                            const geo = await fetch(`/api/geocode?${params}`).then(r => r.json());
                            if (geo.lat && geo.lng) {
                                lat = geo.lat;
                                lng = geo.lng;
                                address = candidate;
                                hasRealLocation = true;
                                console.log(`[Map] "${p.name}" → (${lat}, ${lng}) [${geo.source || 'vworld'}] via "${candidate}"`);
                                break;
                            }
                        } catch (e) { /* 무시 */ }
                    }
                    if (!hasRealLocation) {
                        address = candidates[0] || '';
                        console.warn(`[Map] 지오코딩 실패: "${p.name}" (모든 후보 시도 후 미매칭)`);
                    }
                } else {
                    address = `${p.city || ''} ${p.stateOrProvince || ''}`.trim();
                    console.log(`[Map] Project "${p.name}" has direct coords: (${lat}, ${lng})`);
                }

                allProjects.push({
                    id: p.id,
                    name: p.name,
                    hubId: hub.id,
                    hubName: hub.name,
                    address: address || '주소 미설정',
                    // 주소 없으면 한국 내 임의 위치 (주소 설정 유도)
                    lat: lat ?? (36.5 + (Math.random() - 0.5) * 2),
                    lng: lng ?? (127.5 + (Math.random() - 0.5) * 2),
                    hasRealLocation: !!(lat && lng),
                });
            }
        }

        if (allProjects.length > 0) {
            addProjectMarkers(allProjects, (project) => {
                flyToLocation(project.lat, project.lng, project.hasRealLocation ? 5000 : 100000);
            });

            // 실제 위치가 있는 첫 번째 프로젝트로 카메라 이동
            const firstReal = allProjects.find(p => p.hasRealLocation) || allProjects[0];
            flyToLocation(firstReal.lat, firstReal.lng, 200000);
        }
    } catch (err) {
        console.warn('Map hub load error:', err.message);
    }
}
