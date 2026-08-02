// Mocks 'electron' so src/*.js (written for the main process) can be
// exercised headlessly. Covers the local-storage, project, vault, and
// export pipeline — the parts that don't require live internet access.
const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'hydra-userdata-'));
const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), 'hydra-parent-'));
const tmpSave = fs.mkdtempSync(path.join(os.tmpdir(), 'hydra-save-'));

const mockElectron = {
  app: { getPath: () => tmpUserData, getVersion: () => '1.0.0-test', getName: () => 'hydra-test', on: () => {}, isPackaged: false },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() },
  dialog: {
    showSaveDialog: async (win, opts) => ({ canceled: false, filePath: path.join(tmpSave, path.basename(opts.defaultPath)) }),
    showOpenDialog: async () => ({ canceled: true, filePaths: [] })
  },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  ipcMain: { handle: () => {}, on: () => {} },
  shell: { showItemInFolder: () => {}, openPath: async () => '' }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return mockElectron;
  return originalLoad.apply(this, arguments);
};

let failures = 0;
function check(label, condition) {
  if (condition) console.log(`PASS  ${label}`);
  else { console.log(`FAIL  ${label}`); failures++; }
}

(async () => {
  console.log(`userData: ${tmpUserData}`);
  console.log(`parent:   ${tmpParent}`);
  console.log(`saveDir:  ${tmpSave}`);
  console.log('---');

  const config = require('../src/config');
  const projects = require('../src/projects');
  const db = require('../src/db');
  const vault = require('../src/vault');
  const entities = require('../src/entities');
  const exporter = require('../src/exporter');
  const extract = require('../src/extract');

  // --- config defaults ---
  const cfg0 = config.getSafeConfig();
  check('config has default prompts', typeof cfg0.prompts.systemPrompt === 'string' && cfg0.prompts.systemPrompt.length > 50);
  check('config has default providers', cfg0.providers.brainProvider === 'anthropic' && cfg0.providers.embeddingProvider === 'openai');
  check('no keys present by default', !cfg0.keys.openai.present);
  check('no active project by default', !cfg0.activeProjectPath);

  // --- projects: create ---
  const proj = projects.createProject('Test Investigation', tmpParent);
  check('project created', fs.existsSync(proj.rootPath));
  check('project folder structure scaffolded', fs.existsSync(path.join(proj.rootPath, '01_Raw_Sources')) && fs.existsSync(path.join(proj.rootPath, '02_Processed_Notes')) && fs.existsSync(path.join(proj.rootPath, '03_Entities/People')));
  check('project set as active', projects.getActiveProject().rootPath === proj.rootPath);
  check('project appears in list', projects.listProjects().some(p => p.rootPath === proj.rootPath && p.active));

  // --- db: now project-scoped ---
  const fakeEmbeddingA = Array.from({ length: 8 }, (_, i) => (i === 0 ? 1 : 0));
  const fakeEmbeddingB = Array.from({ length: 8 }, (_, i) => (i === 1 ? 1 : 0));

  db.insertLog({ id: 'log-1', content_hash: 'hash-1', raw_text: 'Minister attended a public infrastructure summit on July 14.', embedding: fakeEmbeddingA, source_type: 'Wiki', primary_entities: ['Test Minister'], related_places: ['Singapore'], target_date: '2026-07-14', reliability_score: 8, discrepancy_flags: 'None' });
  db.insertLog({ id: 'log-2', content_hash: 'hash-2', raw_text: 'A local market report on mango season pricing.', embedding: fakeEmbeddingB, source_type: 'Spreadsheet', primary_entities: [], related_places: ['Dhaka'], target_date: '2026-07-10', reliability_score: 5, discrepancy_flags: 'Not yet verified' });

  const recent = db.getRecentLogs(10);
  check('two logs stored', recent.length === 2);

  const results = db.vectorSearch(fakeEmbeddingA, { topK: 5 });
  check('vector search ranks closest match first', results[0].id === 'log-1' && results[0].similarity > results[1].similarity);

  const stats = db.getStats();
  check('stats.logCount == 2', stats.logCount === 2);
  check('stats.flagged counts non-None flags', stats.flagged === 1);

  // --- FTS5 keyword search ---
  const kwResults = db.keywordSearch('minister summit', { topK: 5 });
  check('keyword search finds the matching log', kwResults.some(r => r.id === 'log-1'));
  check('keyword search does not return the unrelated mango log', !kwResults.some(r => r.id === 'log-2'));

  // --- Knowledge graph ---
  db.upsertRelationship('Test Minister', 'Second Official', 'MET_WITH', 'log-1');
  db.upsertRelationship('Test Minister', 'Second Official', 'MET_WITH', 'log-1'); // second call should bump weight, not duplicate
  const neighbors = db.getEntityNeighbors('Test Minister');
  check('relationship recorded once with weight incremented', neighbors.length === 1 && neighbors[0].weight === 2);
  const fullGraph = db.getGraph();
  check('graph includes both entities as nodes', fullGraph.nodes.some(n => n.id === 'Test Minister') && fullGraph.nodes.some(n => n.id === 'Second Official'));
  check('graph includes the edge', fullGraph.edges.some(e => e.label === 'MET_WITH' && e.weight === 2));

  // --- second project isolation ---
  const proj2 = projects.createProject('Second Project', tmpParent);
  check('switched active project to the new one', projects.getActiveProject().rootPath === proj2.rootPath);
  const statsEmpty = db.getStats();
  check('new project has an isolated, empty database', statsEmpty.logCount === 0);

  projects.switchProject(proj.rootPath);
  const statsBack = db.getStats();
  check('switching back restores original project\'s data', statsBack.logCount === 2);

  const graphModule = require('../src/graph');
  const neighborhood = graphModule.getNeighborhood('Test Minister');
  check('graph neighborhood centers on requested entity', neighborhood.center === 'Test Minister');
  check('graph neighborhood includes the connected node', neighborhood.nodes.some(n => n.id === 'Second Official'));

  const wiki = require('../src/wiki');
  db.saveEntity({ name: 'Test Minister', type: 'person', status: 'Active', tags: [] }); // minimal record so wiki.js gets past the "entity exists" check
  let wikiThrew = false;
  try { await wiki.generateEntityWiki('Test Minister'); }
  catch (err) { wikiThrew = /no Anthropic key is configured/.test(err.message); }
  check('wiki generation fails with a clear message when no brain is configured (no network call attempted)', wikiThrew);


  const saveRes = entities.saveEntity({ name: 'Test Minister', type: 'person', role: 'Cabinet Minister', organization: 'Ministry of Infrastructure', status: 'Active', tags: ['politics'], summary: 'Public official.', good_verified: 'Attended verified summit July 14.', controversial: '', national_relations: '', international_relations: '' });
  check('entity vault file written', saveRes.vaultWritten && fs.existsSync(saveRes.vaultPath));
  check('entity vault file lives under 03_Entities/People', saveRes.vaultPath.includes(path.join('03_Entities', 'People')));
  const entityContent = fs.readFileSync(saveRes.vaultPath, 'utf8');
  check('entity file has no vulnerability/exposure fields', !/Maximum Vulnerability|Minimum Exposure|Maximum Risk/i.test(entityContent));

  // --- vault: processed note with unified frontmatter ---
  const notePath = vault.writeProcessedNote(proj.rootPath, { id: 'log-1', title: 'Test Minister at summit', raw_text: 'Body text here.', source_type: 'Wiki', primary_entities: ['Test Minister'], related_places: ['Singapore'], target_date: '2026-07-14', source_url: 'https://example.com/a', reliability_score: 8, discrepancy_flags: 'None' });
  check('processed note written', fs.existsSync(notePath));
  const noteContent = fs.readFileSync(notePath, 'utf8');
  check('note has id/title/type/tags frontmatter', /^id: "log-1"/m.test(noteContent) && /tags:\s*\n\s*- automated-ingest/.test(noteContent));
  check('note lives under 02_Processed_Notes', notePath.includes('02_Processed_Notes'));

  // --- vault: raw file copy ---
  const fakeRaw = path.join(tmpParent, 'sample.txt');
  fs.writeFileSync(fakeRaw, 'raw source content');
  const copied = vault.copyRawFile(proj.rootPath, fakeRaw);
  check('raw file copied into 01_Raw_Sources', copied && fs.existsSync(copied) && copied.includes('01_Raw_Sources'));

  // --- extract: pptx + xlsx ---
  // Build a minimal valid .pptx (zip) on the fly to test the extractor end-to-end.
  const JSZip = require('jszip');
  const zip = new JSZip();
  zip.file('ppt/slides/slide1.xml', '<p:sld xmlns:a="x"><a:t>Hello slide one</a:t></p:sld>');
  zip.file('ppt/slides/slide2.xml', '<p:sld xmlns:a="x"><a:t>Second slide text</a:t></p:sld>');
  const pptxPath = path.join(tmpParent, 'sample.pptx');
  const pptxBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(pptxPath, pptxBuffer);
  const pptxText = await extract.extractPptx(pptxPath);
  check('pptx extraction finds both slides in order', pptxText.indexOf('Hello slide one') < pptxText.indexOf('Second slide text'));

  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sheet1');
  sheet.addRow(['Name', 'Value']);
  sheet.addRow(['Mango', 120]);
  const xlsxPath = path.join(tmpParent, 'sample.xlsx');
  await wb.xlsx.writeFile(xlsxPath);
  const xlsxText = await extract.extractXlsxPreview(xlsxPath);
  check('xlsx extraction includes sheet name and data', xlsxText.includes('Sheet1') && xlsxText.includes('Mango'));

  // --- exporter (pure local, no network) ---
  const csvRes = await exporter.exportCsv({ kind: 'logs', logs: recent });
  check('CSV export wrote a file', fs.existsSync(csvRes.filePath));
  const xlsxRes = await exporter.exportXlsx({ kind: 'logs', logs: recent });
  check('XLSX export wrote a file', fs.existsSync(xlsxRes.filePath) && fs.statSync(xlsxRes.filePath).size > 0);
  const pdfSimple = await exporter.exportPdf({ kind: 'entity', template: 'simple', entity: entities.getEntity('Test Minister') });
  check('simple PDF export wrote a file', fs.existsSync(pdfSimple.filePath));
  const pdfBranded = await exporter.exportPdf({ kind: 'entity', template: 'branded', entity: entities.getEntity('Test Minister') });
  check('branded PDF export wrote a file', fs.existsSync(pdfBranded.filePath) && fs.statSync(pdfBranded.filePath).size > fs.statSync(pdfSimple.filePath).size * 0.5);

  // --- project removal doesn't delete files ---
  projects.removeProject(proj2.rootPath);
  check('removing a project keeps its folder on disk', fs.existsSync(proj2.rootPath));
  check('removed project no longer listed', !projects.listProjects().some(p => p.rootPath === proj2.rootPath));

  console.log('---');
  console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(err => {
  console.error('TEST HARNESS THREW:', err);
  process.exit(1);
});
