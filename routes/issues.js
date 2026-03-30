const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const handlebars = require('handlebars');

// Register Handlebars eq helper for conditional comparisons
handlebars.registerHelper('eq', (a, b) => a === b);

router.post('/api/issues/export-pdf', async (req, res) => {
    try {
        const data = req.body;
        console.log('[Issues PDF] Export requested.');

        // Normalize: support both single-issue and array-of-issues
        const issuesRaw = Array.isArray(data.issues) ? data.issues : [data];
        const title = data.title || '이슈 해결 결과 보고서';
        const logoBase64 = data.logoBase64 || '';

        // [Field Selector] Build field visibility flags — use data.selectedFields if available, fallback to data.sf
        const rawSf = data.selectedFields || data.sf || {};
        const sf = {
            no: rawSf.no !== false,
            structure: rawSf.structure !== false,
            work_type: rawSf.work_type !== false || rawSf.workType !== false,
            description: rawSf.description !== false,
            resolution: rawSf.resolution !== false,
            screenshot: rawSf.screenshot !== false || rawSf.images !== false
        };

        // Pre-compute combined flag for use in HBS
        sf.hasMetaRow = sf.no || sf.structure || sf.work_type;

        // Calculate colspan for Description/Resolution rows: (No:2 + Struct:2 + Work:2)
        let totalCols = 0;
        if (sf.no) totalCols += 2;
        if (sf.structure) totalCols += 2;
        if (sf.work_type) totalCols += 2;
        sf.colspan = Math.max(1, totalCols - 1);
        sf.totalCols = Math.max(1, totalCols);
        sf.halfCols = Math.max(1, Math.floor(totalCols / 2));

        console.log('[Issues PDF] selectedFields:', sf);

        // Map each raw issue to the template fields
        // status is passed as-is so {{#if (eq status "Closed")}} works in HBS
        const issues = issuesRaw.map((issue, idx) => {
            // [Greedy Extraction Strategy] — Use unique, unambiguous keys
            const rawStruct = (issue.structure_name || issue.structureName || issue.structure || issue.struct || issue.Structure || '').toString().trim();
            const rawWork = (issue.work_type || issue.workType || issue.work_Type || issue.worktype || issue.WorkType || '').toString().trim();

            const finalStruct = rawStruct || '-';
            const finalWork = rawWork || '-';

            const rawKeys = Object.keys(issue || {}).join(', ');
            const valStruct = (issue.structure_name || issue.structureName || '').toString().trim();
            const valWork = (issue.work_type || issue.workType || '').toString().trim();
            const valIssueNum = (issue.issue_number || issue.issueNumber || issue.dbId || issue.id || (idx + 1)).toString().trim();

            return {
                issueId: valIssueNum,
                status: issue.status || 'Open',
                pdf_structure: valStruct || '-',
                pdf_work_type: valWork || '-',
                description: issue.description || '',
                resolution_description: issue.resolution_description || '',
                thumbnail: issue.thumbnail || '',
                after_snapshot_url: issue.after_snapshot_url || ''
            };
        });

        // 2. Read & compile Handlebars template
        const templateData = { title, logoBase64, issues, sf };
        const templatePath = path.join(__dirname, '..', 'views', 'issue-report.hbs');

        const templateHtml = fs.readFileSync(templatePath, 'utf8');
        const template = handlebars.compile(templateHtml);
        const html = template({ title, logoBase64, issues, sf });

        // 3. Launch Puppeteer with generous timeout for many images
        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            timeout: 90000
        });
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(90000);

        await page.setContent(html, { waitUntil: 'networkidle0', timeout: 90000 });

        // 4. Generate PDF (A4 Landscape)
        const pdfBuffer = await page.pdf({
            format: 'A4',
            landscape: true,
            printBackground: true,
            margin: { top: '0', right: '0', bottom: '0', left: '0' }
        });

        await browser.close();

        // 5. Build filename & send
        const filename = issues.length === 1
            ? `issue_report_${issuesRaw[0].id || 'export'}.pdf`
            : `issue_report_batch_${Date.now()}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(Buffer.from(pdfBuffer));

    } catch (err) {
        console.error('[Issues PDF] Error generating PDF:', err);
        res.status(500).json({ error: 'Failed to generate PDF', details: err.message });
    }
});

module.exports = router;
