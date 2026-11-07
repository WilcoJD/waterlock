const { chromium } = require('playwright');
(async () => {
  const [, , htmlPath, pdfPath] = process.argv;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + htmlPath, { waitUntil: 'load', timeout: 300000 });
  await page.pdf({
    path: pdfPath, format: 'A4', landscape: true, printBackground: true, outline: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: '<div style="font-size:7px;color:#8a93a3;width:100%;padding:0 11mm;display:flex;justify-content:space-between;font-family:sans-serif"><span>Open-Source White-Label Business Catalog</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
    margin: { top: '12mm', bottom: '13mm', left: '11mm', right: '11mm' },
    timeout: 0,
  });
  await browser.close();
})();
