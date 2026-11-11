// Render one HTML file to PDF (no header/footer; page numbers are stamped later).
const { chromium } = require('playwright');
(async () => {
  const [, , htmlPath, pdfPath] = process.argv;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + htmlPath, { waitUntil: 'load', timeout: 600000 });
  await page.pdf({ path: pdfPath, format: 'A4', landscape: true, printBackground: true, outline: true,
    margin: { top: '11mm', bottom: '13mm', left: '10mm', right: '10mm' }, timeout: 0 });
  await browser.close();
})();
