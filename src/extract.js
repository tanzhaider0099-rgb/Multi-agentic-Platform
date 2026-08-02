const fs = require('fs');

async function extractPdf(filePath) {
  const pdfParse = require('pdf-parse');
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  if (!data.text || !data.text.trim()) {
    throw new Error('No selectable text was found in this PDF. Scanned/image-only PDFs need OCR — try exporting the page as an image and ingesting that instead.');
  }
  // Re-split by form-feed where pdf-parse preserves page breaks, else return as one block.
  return data.text;
}

function extractPlainText(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  if (!text.trim()) throw new Error('This file appears to be empty.');
  return text;
}

// PPTX is a zip of slide XML files. Pull the <a:t> text runs out of each
// slide in order, matching the reference script's "slide by slide" structure.
async function extractPptx(filePath) {
  const JSZip = require('jszip');
  const buffer = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buffer);

  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)\.xml/)[1], 10);
      const nb = parseInt(b.match(/slide(\d+)\.xml/)[1], 10);
      return na - nb;
    });

  if (!slideFiles.length) throw new Error('No slides were found in this PowerPoint file.');

  let content = '';
  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await zip.files[slideFiles[i]].async('string');
    const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]);
    content += `## --- SLIDE ${i + 1} ---\n\n${texts.join('\n')}\n\n`;
  }
  if (!content.trim()) throw new Error('Slides were found but contained no extractable text.');
  return content;
}

// XLSX preview: dimensions + first 10 rows per sheet as a Markdown table,
// matching the reference script's spreadsheet-summary approach.
async function extractXlsxPreview(filePath) {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  let content = '';
  workbook.worksheets.forEach(sheet => {
    const rows = [];
    sheet.eachRow((row) => { rows.push(row.values.slice(1)); });
    const headerRow = rows[0] || [];
    const dataRows = rows.slice(1, 11);
    content += `## Sheet: ${sheet.name}\n\nDimensions: ${sheet.rowCount} rows, ${sheet.columnCount} columns.\n\n`;
    if (headerRow.length) {
      content += `| ${headerRow.map(h => String(h ?? '')).join(' | ')} |\n`;
      content += `| ${headerRow.map(() => '---').join(' | ')} |\n`;
      dataRows.forEach(r => { content += `| ${headerRow.map((_, i) => String(r[i] ?? '')).join(' | ')} |\n`; });
    }
    content += '\n';
  });
  if (!content.trim()) throw new Error('No readable sheets were found in this workbook.');
  return content;
}

module.exports = { extractPdf, extractPlainText, extractPptx, extractXlsxPreview };
