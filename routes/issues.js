/**
 * Issues Routes — 이슈 보고서 PDF 내보내기
 *
 * POST /api/issues/export-pdf
 *   body: { title, logoBase64, issues[] | single, selectedFields / sf }
 */
'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const handlebars = require('handlebars');
const { asyncHandler, AppError, rateLimit } = require('../middleware');

// PDF 생성은 리소스 집약적이므로 IP 당 분당 10회로 제한
const pdfRateLimit = rateLimit({
    windowMs: 60_000,
    max: 10,
    message: 'PDF 내보내기 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
});

const router = express.Router();

// Handlebars 헬퍼
handlebars.registerHelper('eq', (a, b) => a === b);

// 템플릿 캐시 (파일 변경시에도 서버 재시작하면 반영)
let compiledTemplate = null;
function getTemplate() {
    if (compiledTemplate) return compiledTemplate;
    const templatePath = path.join(__dirname, '..', 'views', 'issue-report.hbs');
    const src = fs.readFileSync(templatePath, 'utf8');
    compiledTemplate = handlebars.compile(src);
    return compiledTemplate;
}

// 필드 표시 플래그 정규화 (문자열 "false" 도 false로)
function normalizeFieldFlags(raw) {
    const toBool = (v) => v !== false && String(v) !== 'false';
    const sf = {
        no: toBool(raw.no),
        structure: toBool(raw.structure),
        work_type: toBool(raw.work_type),
        description: toBool(raw.description),
        resolution: toBool(raw.resolution),
        screenshot: toBool(raw.screenshot),
    };
    sf.hasMetaRow = sf.no || sf.structure || sf.work_type;

    let cols = 0;
    if (sf.no) cols += 2;
    if (sf.structure) cols += 2;
    if (sf.work_type) cols += 2;
    sf.colspan = Math.max(1, cols - 1);
    sf.totalCols = Math.max(1, cols);
    sf.halfCols = Math.max(1, Math.floor(cols / 2));
    return sf;
}

function mapIssue(raw, idx) {
    const s = (v) => (v ?? '').toString().trim();
    return {
        issueId: s(raw.issue_number || raw.issueNumber || raw.dbId || raw.id || idx + 1),
        status: raw.status || 'Open',
        pdf_structure: s(raw.structure_name || raw.structureName || raw.structure) || '-',
        pdf_work_type: s(raw.work_type || raw.workType) || '-',
        description: raw.description || '',
        resolution_description: raw.resolution_description || '',
        thumbnail: raw.thumbnail || '',
        after_snapshot_url: raw.after_snapshot_url || '',
    };
}

// ── POST /api/issues/export-pdf ────────────────────────────────
router.post('/api/issues/export-pdf', pdfRateLimit, asyncHandler(async (req, res) => {
    const data = req.body || {};
    const issuesRaw = Array.isArray(data.issues) ? data.issues : [data];
    if (!issuesRaw.length) throw new AppError('이슈 데이터가 비어 있습니다.', 400, 'VALIDATION_ERROR');

    const title = data.title || '이슈 해결 결과 보고서';
    const logoBase64 = data.logoBase64 || '';
    const sf = normalizeFieldFlags(data.selectedFields || data.sf || {});
    const issues = issuesRaw.map(mapIssue);

    console.log(`[issues] Exporting ${issues.length} issue(s) to PDF`);

    const html = getTemplate()({ title, logoBase64, issues, sf });

    // Puppeteer: Windows/ngrok 환경 호환성 유지, 안전한 타임아웃
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        timeout: 90_000,
    });
    try {
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(90_000);
        await page.setContent(html, { waitUntil: 'networkidle0', timeout: 90_000 });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            landscape: true,
            printBackground: true,
            margin: { top: '0', right: '0', bottom: '0', left: '0' },
        });

        const filename = issues.length === 1
            ? `issue_report_${issuesRaw[0].id || 'export'}.pdf`
            : `issue_report_batch_${Date.now()}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(Buffer.from(pdfBuffer));
    } finally {
        await browser.close().catch(() => {});
    }
}));

module.exports = router;
