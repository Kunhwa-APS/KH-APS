/**
 * PropertyWorker.js - Web Worker for processing BIM model properties
 */

self.onmessage = function (e) {
    const { results, modelData } = e.data;

    try {
        const categoryMap = {};
        const startTime = performance.now();

        results.forEach(res => {
            const categoryProp = res.properties.find(p => p.displayName === 'Category' || p.attributeName === 'Category');
            if (categoryProp && categoryProp.displayValue) {
                // Revit 접두사 제거 및 정리
                let catName = categoryProp.displayValue.toString().replace('Revit ', '').trim();
                // 유효하지 않은 카테고리(<...>) 제외
                if (catName && !catName.startsWith('<')) {
                    categoryMap[catName] = (categoryMap[catName] || 0) + 1;
                }
            }
        });

        const categories = categoryMap;
        const totalElements = Object.values(categoryMap).reduce((a, b) => a + b, 0);
        const categoryList = Object.keys(categoryMap).sort();

        const duration = performance.now() - startTime;
        console.log(`[PropertyWorker] Processed ${results.length} properties in ${duration.toFixed(2)}ms`);

        // 결과 반환
        self.postMessage({
            success: true,
            modelData: {
                ...modelData,
                categories,
                totalElements,
                categoryList
            }
        });
    } catch (err) {
        self.postMessage({
            success: false,
            error: err.message
        });
    }
};
