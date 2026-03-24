// VWorld 3D Map 모듈 - Cesium.js + VWorld WMTS 타일
// VWorld API Key: https://www.vworld.kr/dev/v4dv_apim_s001.do (무료 발급)

let cesiumViewer = null;
let vworldApiKey = null;

/**
 * VWorld 3D Map 초기화
 * @param {string} containerId - 지도를 삽입할 div id
 * @param {string} apiKey - VWorld API Key
 */
export async function initMap(containerId, apiKey) {
    vworldApiKey = apiKey;

    // Cesium Ion 사용 안 함 (토큰 불필요)
    Cesium.Ion.defaultAccessToken = undefined;

    // VWorld 위성 영상 타일 - 서버 프록시 경유 (CORS 우회)
    const vworldSatellite = new Cesium.UrlTemplateImageryProvider({
        url: '/api/tiles/vworld/Satellite/{z}/{y}/{x}',
        tilingScheme: new Cesium.WebMercatorTilingScheme(), // VWorld는 GoogleMapsCompatible(WebMercator)
        maximumLevel: 19,
        credit: new Cesium.Credit('© VWorld (국토교통부)', true),
    });

    // VWorld 하이브리드 오버레이 (도로/지명)
    const vworldHybrid = new Cesium.UrlTemplateImageryProvider({
        url: '/api/tiles/vworld/Hybrid/{z}/{y}/{x}',
        maximumLevel: 19,
    });

    cesiumViewer = new Cesium.Viewer(containerId, {
        imageryProvider: false,           // Cesium 1.99+: deprecated - 직접 레이어 추가
        terrainProvider: new Cesium.EllipsoidTerrainProvider(),
        baseLayerPicker: false,
        navigationHelpButton: false,
        homeButton: true,
        sceneModePicker: true,
        geocoder: false,
        animation: false,
        timeline: false,
        fullscreenButton: true,
        infoBox: true,
        selectionIndicator: true,
        shadows: false,
    });

    // 기존 레이어 전체 제거
    cesiumViewer.imageryLayers.removeAll();

    // 1번 레이어: VWorld 위성 영상 (트루 베이스)
    cesiumViewer.imageryLayers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
            url: '/api/tiles/vworld/Satellite/{z}/{y}/{x}',
            tilingScheme: new Cesium.WebMercatorTilingScheme(),
            maximumLevel: 19,
            credit: new Cesium.Credit('© VWorld (국토교통부)', true),
        })
    );

    // 2번 레이어: VWorld Base 도로/지명 반투명 오버레이
    const baseOverlay = cesiumViewer.imageryLayers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
            url: '/api/tiles/vworld/Base/{z}/{y}/{x}',
            tilingScheme: new Cesium.WebMercatorTilingScheme(),
            maximumLevel: 19,
        })
    );
    baseOverlay.alpha = 0.35;

    // 카메라 초기 위치: 대한민국 전체
    cesiumViewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(127.5, 36.5, 1500000),
        orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-60),
            roll: 0,
        },
        duration: 2,
    });

    // Cesium 크레딧 패널 숨김 (필요 시 주석 해제)
    cesiumViewer._cesiumWidget._creditContainer.style.display = 'none';

    return cesiumViewer;
}

/**
 * ACC 프로젝트를 3D 지도에 핀 마커로 표시
 */
export function addProjectMarkers(projects, onProjectClick) {
    if (!cesiumViewer) return;

    cesiumViewer.entities.removeAll();

    projects.forEach(project => {
        if (project.lat == null || project.lng == null) return;

        const coordText = `${project.lat.toFixed(5)}°N, ${project.lng.toFixed(5)}°E`;
        const locationIcon = project.hasRealLocation ? '📍' : '📌';

        cesiumViewer.entities.add({
            name: project.name,
            position: Cesium.Cartesian3.fromDegrees(project.lng, project.lat, 100),
            billboard: {
                image: createPinCanvas(project.hasRealLocation),
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                scale: 1.0,
                heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: {
                // 프로젝트명 + 좌표 표시
                text: `${project.name}\n${coordText}`,
                font: '12px Inter, Noto Sans KR, sans-serif',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.fromCssColorString('#1e293b'),
                outlineWidth: 3,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -55),
                heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                showBackground: true,
                backgroundColor: Cesium.Color.fromCssColorString('#1e293bbb'),
                backgroundPadding: new Cesium.Cartesian2(8, 5),
            },
            // 마커 클릭 시 InfoBox에 상세 정보 표시
            description: `
                <div style="font-family:Inter,sans-serif;padding:8px;min-width:220px">
                    <h3 style="margin:0 0 8px;font-size:14px;color:#1e293b">${locationIcon} ${project.name}</h3>
                    <table style="width:100%;font-size:12px;border-collapse:collapse">
                        <tr><td style="color:#64748b;padding:2px 6px 2px 0">위도</td><td><b>${project.lat.toFixed(6)}°N</b></td></tr>
                        <tr><td style="color:#64748b;padding:2px 6px 2px 0">경도</td><td><b>${project.lng.toFixed(6)}°E</b></td></tr>
                        <tr><td style="color:#64748b;padding:2px 6px 2px 0">주소</td><td>${project.address || '-'}</td></tr>
                        <tr><td style="color:#64748b;padding:2px 6px 2px 0">허브</td><td>${project.hubName || '-'}</td></tr>
                        <tr><td style="color:#64748b;padding:2px 6px 2px 0">위치 정확도</td><td>${project.hasRealLocation ? '✅ 실주소 지오코딩' : '⚠️ 임의 위치'}</td></tr>
                    </table>
                </div>`,
            properties: { projectData: project },
        });
    });

    // 클릭 핸들러
    cesiumViewer.screenSpaceEventHandler.setInputAction((click) => {
        const picked = cesiumViewer.scene.pick(click.position);
        if (Cesium.defined(picked) && picked.id && picked.id.properties) {
            const data = picked.id.properties.projectData.getValue();
            if (data && onProjectClick) onProjectClick(data);
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

/**
 * 특정 위치로 3D 카메라 이동
 */
export function flyToLocation(lat, lng, heightMeters = 5000) {
    if (!cesiumViewer) return;
    cesiumViewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lng, lat, heightMeters),
        orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-45),
            roll: 0,
        },
        duration: 2,
    });
}

/**
 * 지도 크기 갱신 (탭 전환 시 필요)
 */
export function resizeMap() {
    if (cesiumViewer) cesiumViewer.resize();
}

/**
 * 캔버스로 핀 아이콘 생성
 */
function createPinCanvas(hasRealLocation = true) {
    const canvas = document.createElement('canvas');
    canvas.width = 36;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');

    // 그림자
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 3;

    // 핀 원 (실주소=보라, 임의위치=주황)
    ctx.beginPath();
    ctx.arc(18, 17, 15, 0, Math.PI * 2);
    ctx.fillStyle = hasRealLocation ? '#6366f1' : '#f59e0b';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // 핀 꼬리
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(10, 28);
    ctx.lineTo(18, 48);
    ctx.lineTo(26, 28);
    ctx.fillStyle = '#6366f1';
    ctx.fill();

    // 중앙 점
    ctx.beginPath();
    ctx.arc(18, 17, 6, 0, Math.PI * 2);
    ctx.fillStyle = 'white';
    ctx.fill();

    return canvas.toDataURL();
}
