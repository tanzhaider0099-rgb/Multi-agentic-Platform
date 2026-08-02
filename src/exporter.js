const { dialog, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('./config');

function focusedWindow() { return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]; }

async function pickSavePath(defaultName, filters) {
  const res = await dialog.showSaveDialog(focusedWindow(), { defaultPath: path.join(os.homedir(), 'Desktop', defaultName), filters });
  if (res.canceled || !res.filePath) return null;
  return res.filePath;
}

function csvEscape(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function rowsForPayload(payload) {
  if (payload.kind === 'search') {
    return (payload.sources || []).map(s => ({
      id: s.id, source_type: s.source_type, target_date: s.target_date, reliability_score: s.reliability_score,
      discrepancy_flags: s.discrepancy_flags, primary_entities: (s.primary_entities || []).join('; '), similarity: s.similarity
    }));
  }
  if (payload.kind === 'logs') {
    return (payload.logs || []).map(l => ({
      id: l.id, source_type: l.source_type, target_date: l.target_date, reliability_score: l.reliability_score,
      discrepancy_flags: l.discrepancy_flags, primary_entities: (l.primary_entities || []).join('; '),
      related_places: (l.related_places || []).join('; '), recorded_at: l.recorded_at
    }));
  }
  return [];
}

async function exportCsv(payload) {
  const rows = rowsForPayload(payload);
  if (!rows.length) throw new Error('There is nothing to export yet.');
  const filePath = await pickSavePath(`hydra-${payload.kind}.csv`, [{ name: 'CSV', extensions: ['csv'] }]);
  if (!filePath) return { canceled: true };
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')].concat(rows.map(r => headers.map(h => csvEscape(r[h])).join(',')));
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return { filePath };
}

async function exportXlsx(payload) {
  const ExcelJS = require('exceljs');
  const rows = rowsForPayload(payload);
  if (!rows.length) throw new Error('There is nothing to export yet.');
  const filePath = await pickSavePath(`hydra-${payload.kind}.xlsx`, [{ name: 'Excel Workbook', extensions: ['xlsx'] }]);
  if (!filePath) return { canceled: true };
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Data');
  sheet.columns = Object.keys(rows[0]).map(key => ({ header: key, key, width: 22 }));
  sheet.getRow(1).font = { bold: true };
  rows.forEach(r => sheet.addRow(r));
  await workbook.xlsx.writeFile(filePath);
  return { filePath };
}

// template: 'simple' (clean, minimal) or 'branded' (Hydra header band + footer).
// Falls back to Settings → Prompt Chamber's saved default if none is passed.
async function exportPdf(payload) {
  const PDFDocument = require('pdfkit');
  const cfg = config.getSafeConfig();
  const template = payload.template || cfg.providers.pdfTemplate || 'simple';
  const defaultName = payload.kind === 'entity' ? `${(payload.entity?.name || 'entity').replace(/\s+/g, '-')}.pdf` : 'hydra-report.pdf';
  const filePath = await pickSavePath(defaultName, [{ name: 'PDF', extensions: ['pdf'] }]);
  if (!filePath) return { canceled: true };

  const doc = new PDFDocument({ margin: 50 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  if (template === 'branded') {
    doc.rect(0, 0, doc.page.width, 70).fill('#12151b');
    doc.fillColor('#c9a227').fontSize(20).text('HYDRA', 50, 24, { continued: false });
    doc.fillColor('#9aa1ae').fontSize(9).text('Research intelligence export', 50, 46);
    doc.fillColor('#000').moveDown(3);
    doc.y = 100;
  }

  if (payload.kind === 'search') {
    doc.fontSize(18).text('Research Query', { underline: true });
    doc.moveDown();
    doc.fontSize(12).fillColor('#333').text(`Question: ${payload.question}`);
    doc.moveDown();
    doc.fontSize(11).fillColor('#000').text(payload.answer || '', { align: 'left' });
    doc.moveDown();
    doc.fontSize(13).text('Sources', { underline: true });
    (payload.sources || []).forEach((s, i) => {
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor('#000').text(`${i + 1}. [${s.source_type}] ${s.target_date || 'undated'} — reliability ${s.reliability_score}/10 — ${s.discrepancy_flags}`);
    });
  } else if (payload.kind === 'entity') {
    const e = payload.entity;
    doc.fontSize(18).text(e.name, { underline: true });
    doc.fontSize(11).fillColor('#555').text(`${e.role || ''}${e.organization ? ' — ' + e.organization : ''}`);
    doc.moveDown();
    doc.fontSize(13).fillColor('#000').text('Executive Summary');
    doc.fontSize(11).text(e.summary || 'None recorded.');
    doc.moveDown();
    doc.fontSize(13).text('Documented & Verified');
    doc.fontSize(11).text(e.good_verified || 'None recorded.');
    doc.moveDown();
    doc.fontSize(13).text('Disputed / Under Scrutiny');
    doc.fontSize(11).text(e.controversial || 'None recorded.');
    doc.moveDown();
    doc.fontSize(13).text('Relations & Networks');
    doc.fontSize(11).text(`National: ${e.national_relations || 'None recorded.'}`);
    doc.fontSize(11).text(`International: ${e.international_relations || 'None recorded.'}`);
  } else {
    doc.fontSize(18).text('Hydra — Export');
    doc.moveDown();
    doc.fontSize(11).text(JSON.stringify(payload, null, 2));
  }

  if (template === 'branded') {
    const bottom = doc.page.height - 40;
    doc.fontSize(8).fillColor('#9aa1ae').text(`Generated by Hydra on ${new Date().toLocaleString()}`, 50, bottom, { align: 'center', width: doc.page.width - 100 });
  }

  doc.end();
  await new Promise((resolve, reject) => { stream.on('finish', resolve); stream.on('error', reject); });
  return { filePath };
}

module.exports = { exportCsv, exportXlsx, exportPdf };
