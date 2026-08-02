const { contextBridge, ipcRenderer } = require('electron');

function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args);
}

contextBridge.exposeInMainWorld('hydra', {
  config: {
    get: () => invoke('config:get'),
    set: (partial) => invoke('config:set', partial),
    testOpenAI: (key) => invoke('config:test-openai', key),
    testAnthropic: (key) => invoke('config:test-anthropic', key),
    testSupabase: (url, key) => invoke('config:test-supabase', url, key),
    testTavily: (key) => invoke('config:test-tavily', key),
    testElevenlabs: (key) => invoke('config:test-elevenlabs', key),
    testOllama: (host) => invoke('config:test-ollama', host),
    resetPrompts: () => invoke('config:reset-prompts')
  },
  projects: {
    list: () => invoke('projects:list'),
    current: () => invoke('projects:current'),
    create: (name) => invoke('projects:create', name),
    open: () => invoke('projects:open'),
    switchTo: (rootPath) => invoke('projects:switch', rootPath),
    remove: (rootPath) => invoke('projects:remove', rootPath)
  },
  ingest: {
    chooseFiles: () => invoke('ingest:choose-files'),
    runFile: (filePath) => invoke('ingest:run-file', filePath),
    runUrl: (url) => invoke('ingest:run-url', url),
    runText: (payload) => invoke('ingest:run-text', payload),
    recent: () => invoke('ingest:recent')
  },
  search: { query: (question) => invoke('search:query', question) },
  factcheck: { run: (logId) => invoke('factcheck:run', logId) },
  graph: {
    full: () => invoke('graph:full'),
    neighborhood: (name) => invoke('graph:neighborhood', name)
  },
  wiki: { generate: (name) => invoke('wiki:generate', name) },
  entities: {
    list: () => invoke('entities:list'),
    get: (name) => invoke('entities:get', name),
    save: (entity) => invoke('entities:save', entity),
    remove: (name) => invoke('entities:delete', name)
  },
  exportData: {
    pdf: (payload) => invoke('export:pdf', payload),
    csv: (payload) => invoke('export:csv', payload),
    xlsx: (payload) => invoke('export:xlsx', payload),
    openFolder: (filePath) => invoke('export:open-folder', filePath)
  },
  system: {
    openLog: () => invoke('system:open-log'),
    openPath: (targetPath) => invoke('system:open-path', targetPath),
    stats: () => invoke('system:stats')
  },
  onAppError: (callback) => ipcRenderer.on('app:error', (_e, payload) => callback(payload))
});
