/**
 * [Harness Engineering] Export-Utils
 * export-utils.js - 브라우저 기반 데이터 내보내기 (PDF 추출) 엔진
 */

(function () {
    'use strict';

    const ExportUtils = {
        /**
         * 이슈 데이터를 PDF로 생성하여 다운로드합니다.
         * @param {Array} issues 
         */
        exportIssuesToPDF: async function (issues) {
            console.log('[Export-Utils] PDF 생성 시작:', issues.length, '개의 이슈');

            // jsPDF 라이브러리 동적 로드 (CDN)
            if (typeof jspdf === 'undefined') {
                await this._loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
                await this._loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.25/jspdf.plugin.autotable.min.js');
            }

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();

            // 타이틀 추가
            doc.setFontSize(18);
            doc.text('BIM Project Issues Report', 14, 22);
            doc.setFontSize(11);
            doc.setTextColor(100);

            const now = new Date();
            doc.text(`Generated on: ${now.toLocaleString()}`, 14, 30);
            doc.text(`Total Issues: ${issues.length}`, 14, 36);

            // 테이블 데이터 준비
            const tableColumn = ["ID", "Title", "Status", "Assignee", "Created At"];
            const tableRows = [];

            issues.forEach(issue => {
                const issueData = [
                    issue.issueNumber || issue.id,
                    issue.title,
                    issue.status,
                    issue.assignee || 'Unassigned',
                    new Date(issue.createdAt || Date.now()).toLocaleDateString()
                ];
                tableRows.push(issueData);
            });

            // 테이블 생성
            doc.autoTable({
                head: [tableColumn],
                body: tableRows,
                startY: 45,
                theme: 'grid',
                headStyles: { fillColor: [41, 128, 185], textColor: 255 },
                styles: { fontSize: 9 }
            });

            // 저장
            const fileName = `BIM_Issues_Report_${now.toISOString().slice(0, 10)}.pdf`;
            doc.save(fileName);
            console.log('[Export-Utils] PDF 내보내기 완료:', fileName);
            return fileName;
        },

        /**
         * 외부 스크립트 동적 로드 헬퍼
         */
        _loadScript: function (url) {
            return new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = url;
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }
    };

    window.ExportUtils = ExportUtils;
})();
