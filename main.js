const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const userDataPath = app.getPath('userData');
const logFile = path.join(userDataPath, 'hydra.log');

function log(level, msg, extra) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}${extra ? ' :: ' + JSON.stringify(extra) : ''}\n`;
  try { fs.appendFileSync(logFile, line); } catch (e) { /* nothing more we can do */ }
  if (level === 'ERROR') console.error(line); else console.log(line);
}

process.on('uncaughtException', (err) => {
  log('ERROR', 'uncaughtException', { message: err.message, stack: err.stack });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:error', { title: 'Something went wrong', message: err.message || 'An unexpected error occurred.', recoverable: true });
  }
});
process.on('unhandledRejection', (reason) => {
  const message = reason && reason.message ? reason.message : String(reason);
  log('ERROR', 'unhandledRejection', { message });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:error', { title: 'Background task failed', message, recoverable: true });
  }
});

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1420, height: 880, minWidth: 1080, minHeight: 700,
    backgroundColor: '#12151b',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
    show: false
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log('ERROR', 'render-process-gone', details);
    dialog.showErrorBox('Hydra crashed', 'The interface stopped responding and will restart.');
    createWindow();
  });
}

app.whenReady().then(() => {
  log('INFO', 'app-ready');
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

function registerIpc() {
  const configStore = require('./src/config');
  const db = require('./src/db');
  const projects = require('./src/projects');
  const ingest = require('./src/ingest');
  const search = require('./src/search');
  const entities = require('./src/entities');
  const exporter = require('./src/exporter');
  const factcheck = require('./src/factcheck');
  const graph = require('./src/graph');
  const wiki = require('./src/wiki');

  function safeHandle(channel, handler) {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        const data = await handler(event, ...args);
        return { ok: true, data };
      } catch (err) {
        log('ERROR', `ipc:${channel}`, { message: err.message, stack: err.stack });
        return { ok: false, error: err.message || 'Unknown error' };
      }
    });
  }

  // Config / Prompt Chamber
  safeHandle('config:get', () => configStore.getSafeConfig());
  safeHandle('config:set', (_e, partial) => configStore.setConfig(partial));
  safeHandle('config:test-openai', (_e, key) => configStore.testOpenAI(key));
  safeHandle('config:test-anthropic', (_e, key) => configStore.testAnthropic(key));
  safeHandle('config:test-supabase', (_e, url, key) => configStore.testSupabase(url, key));
  safeHandle('config:test-tavily', (_e, key) => configStore.testTavily(key));
  safeHandle('config:test-elevenlabs', (_e, key) => configStore.testElevenlabs(key));
  safeHandle('config:test-ollama', (_e, host) => configStore.testOllama(host));
  safeHandle('config:reset-prompts', () => configStore.resetPrompts());

  // Projects
  safeHandle('projects:list', () => projects.listProjects());
  safeHandle('projects:current', () => projects.getActiveProject());
  safeHandle('projects:create', async (_e, name) => {
    const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'], title: 'Choose where to create this project' });
    if (res.canceled || !res.filePaths.length) return null;
    return projects.createProject(name, res.filePaths[0]);
  });
  safeHandle('projects:open', async () => {
    const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: 'Open an existing folder as a Hydra project' });
    if (res.canceled || !res.filePaths.length) return null;
    return projects.openProjectFolder(res.filePaths[0]);
  });
  safeHandle('projects:switch', (_e, rootPath) => projects.switchProject(rootPath));
  safeHandle('projects:remove', (_e, rootPath) => { db.closeConnection(rootPath); return projects.removeProject(rootPath); });

  // Ingestion
  safeHandle('ingest:choose-files', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Supported files', extensions: ['png', 'jpg', 'jpeg', 'webp', 'mp3', 'mp4', 'wav', 'm4a', 'mov', 'avi', 'pdf', 'pptx', 'xlsx', 'xls', 'csv', 'txt', 'md'] }]
    });
    if (res.canceled) return [];
    return res.filePaths;
  });
  safeHandle('ingest:run-file', (_e, filePath) => ingest.ingestFile(filePath));
  safeHandle('ingest:run-url', (_e, url) => ingest.ingestUrl(url));
  safeHandle('ingest:run-text', (_e, payload) => ingest.ingestRawText(payload));
  safeHandle('ingest:recent', () => db.getRecentLogs(50));

  // Search / RAG
  safeHandle('search:query', (_e, question) => search.runQuery(question));

  // Fact-check
  safeHandle('factcheck:run', (_e, logId) => factcheck.verifyLog(logId));

  // Knowledge graph & wiki
  safeHandle('graph:full', () => graph.getFullGraph());
  safeHandle('graph:neighborhood', (_e, name) => graph.getNeighborhood(name));
  safeHandle('wiki:generate', (_e, name) => wiki.generateEntityWiki(name));

  // Entities
  safeHandle('entities:list', () => entities.listEntities());
  safeHandle('entities:get', (_e, name) => entities.getEntity(name));
  safeHandle('entities:save', (_e, entity) => entities.saveEntity(entity));
  safeHandle('entities:delete', (_e, name) => entities.deleteEntity(name));

  // Export
  safeHandle('export:pdf', (_e, payload) => exporter.exportPdf(payload));
  safeHandle('export:csv', (_e, payload) => exporter.exportCsv(payload));
  safeHandle('export:xlsx', (_e, payload) => exporter.exportXlsx(payload));
  safeHandle('export:open-folder', (_e, filePath) => shell.showItemInFolder(filePath));

  // System
  safeHandle('system:open-log', () => shell.openPath(logFile));
  safeHandle('system:open-path', (_e, targetPath) => shell.openPath(targetPath));
  safeHandle('system:stats', () => db.getStats());
}

module.exports = { log };
