(function () {
  'use strict';

  // ---------------- Toasts & error modal ----------------
  function toast(message, type) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type || ''}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 6000);
  }
  function showError(title, message) {
    document.getElementById('error-title').textContent = title || 'Something went wrong';
    document.getElementById('error-message').textContent = message || '';
    document.getElementById('error-modal').classList.remove('hidden');
  }
  document.getElementById('error-dismiss').addEventListener('click', () => document.getElementById('error-modal').classList.add('hidden'));
  document.getElementById('error-open-log').addEventListener('click', () => window.hydra.system.openLog());
  window.hydra.onAppError((payload) => showError(payload.title, payload.message));

  async function call(promise, friendlyContext) {
    const res = await promise;
    if (!res.ok) {
      toast(`${friendlyContext ? friendlyContext + ': ' : ''}${res.error}`, 'error');
      return null;
    }
    return res.data;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------------- Navigation ----------------
  const views = document.querySelectorAll('.view');
  const tabs = document.querySelectorAll('.tab');
  function showView(name) {
    views.forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
    tabs.forEach(t => t.classList.toggle('active', t.dataset.view === name));
    if (name === 'dashboard') loadDashboard();
    if (name === 'entities') loadEntitiesList();
    if (name === 'settings') loadSettings();
    if (name === 'graph') document.getElementById('graph-load-full').click();
  }
  tabs.forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));

  // ---------------- Project bar ----------------
  let currentProject = null;

  async function refreshProjectPill() {
    currentProject = await call(window.hydra.projects.current());
    const dot = document.querySelector('.project-pill-dot');
    const nameEl = document.getElementById('project-pill-name');
    const dashName = document.getElementById('dash-project-name');
    if (currentProject) {
      dot.classList.remove('inactive');
      nameEl.textContent = currentProject.name;
      if (dashName) dashName.textContent = `"${currentProject.name}"`;
    } else {
      dot.classList.add('inactive');
      nameEl.textContent = 'No project open';
      if (dashName) dashName.textContent = 'this project';
    }
    const activeLabel = document.getElementById('settings-active-project');
    if (activeLabel) activeLabel.textContent = currentProject ? `${currentProject.name} — ${currentProject.rootPath}` : 'No project open';
  }

  document.getElementById('project-switcher').addEventListener('click', openProjectModal);
  document.getElementById('settings-manage-projects').addEventListener('click', openProjectModal);
  document.getElementById('pm-close').addEventListener('click', () => document.getElementById('project-modal').classList.add('hidden'));

  async function openProjectModal() {
    document.getElementById('project-modal').classList.remove('hidden');
    await renderProjectList();
  }

  async function renderProjectList() {
    const list = await call(window.hydra.projects.list());
    const container = document.getElementById('pm-list');
    if (!list) return;
    container.innerHTML = list.length
      ? list.map(p => `
        <div class="project-list-item ${p.active ? 'active' : ''}" data-path="${escapeHtml(p.rootPath)}">
          <div>
            <div><strong>${escapeHtml(p.name)}</strong>${p.active ? ' <span class="tag tag-verified">active</span>' : ''}</div>
            <div class="muted small">${escapeHtml(p.rootPath)}</div>
          </div>
          <div class="project-list-actions">
            ${p.active ? '' : `<button class="btn btn-secondary switch-project-btn">Switch to</button>`}
            <button class="btn btn-danger remove-project-btn">Remove</button>
          </div>
        </div>`).join('')
      : '<p class="muted small">No projects yet. Create one to get started.</p>';

    container.querySelectorAll('.switch-project-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const rootPath = e.target.closest('.project-list-item').dataset.path;
        const res = await call(window.hydra.projects.switchTo(rootPath), 'Switch project');
        if (res) { toast(`Switched to "${res.name}".`, 'success'); await refreshProjectPill(); await renderProjectList(); loadDashboard(); }
      });
    });
    container.querySelectorAll('.remove-project-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const item = e.target.closest('.project-list-item');
        const rootPath = item.dataset.path;
        const name = item.querySelector('strong').textContent;
        if (!confirm(`Remove "${name}" from Hydra's project list?\n\nThis does NOT delete any files — it only forgets the project. You can re-open the same folder anytime.`)) return;
        await call(window.hydra.projects.remove(rootPath), 'Remove project');
        toast('Project removed from list.', 'success');
        await refreshProjectPill();
        await renderProjectList();
      });
    });
  }

  document.getElementById('pm-create').addEventListener('click', createProjectFlow);
  document.getElementById('pm-open').addEventListener('click', openProjectFlow);

  async function createProjectFlow() {
    const name = prompt('Name this project (e.g. "Q3 Infrastructure Investigation"):');
    if (!name || !name.trim()) return;
    const res = await call(window.hydra.projects.create(name.trim()), 'Create project');
    if (res) {
      toast(`Project "${res.name}" created and opened.`, 'success');
      await refreshProjectPill(); await renderProjectList(); loadDashboard();
    }
  }
  async function openProjectFlow() {
    const res = await call(window.hydra.projects.open(), 'Open project');
    if (res) {
      toast(`Opened "${res.name}".`, 'success');
      await refreshProjectPill(); await renderProjectList(); loadDashboard();
    }
  }

  // ---------------- Formatting helpers ----------------
  function stampBadge(score, flags) {
    const flagged = flags && flags !== 'None' && flags !== 'Not yet verified';
    const cls = flagged ? 'stamp-badge flagged' : 'stamp-badge';
    return `<div class="${cls}" title="${escapeHtml(flags || '')}"><span>${score ?? '–'}/10</span></div>`;
  }
  function logEntryHtml(log, actionsHtml) {
    const entities = (log.primary_entities || []).join(', ') || 'none';
    const places = (log.related_places || []).join(', ') || 'none';
    return `
      <div class="log-entry" data-id="${log.id}">
        ${stampBadge(log.reliability_score, log.discrepancy_flags)}
        <div class="log-entry-body">
          <div class="log-entry-title">${escapeHtml(log.source_type)} ${log.target_date ? '· ' + log.target_date : ''}</div>
          <div class="log-entry-meta">Entities: ${escapeHtml(entities)} · Places: ${escapeHtml(places)}</div>
          ${log.preview ? `<div class="log-entry-preview">${escapeHtml(log.preview)}…</div>` : ''}
        </div>
        <div class="log-entry-actions">${actionsHtml || ''}</div>
      </div>`;
  }

  // ---------------- Dashboard ----------------
  async function loadDashboard() {
    const stats = await call(window.hydra.system.stats());
    const grid = document.getElementById('stat-grid');
    if (stats) {
      grid.innerHTML = `
        <div class="stat-card"><div class="stat-num">${stats.logCount}</div><div class="stat-label">Entries ingested</div></div>
        <div class="stat-card"><div class="stat-num">${stats.entityCount}</div><div class="stat-label">Entities tracked</div></div>
        <div class="stat-card"><div class="stat-num">${stats.avgReliability ?? '–'}</div><div class="stat-label">Avg. reliability</div></div>
        <div class="stat-card"><div class="stat-num">${stats.flagged}</div><div class="stat-label">Flagged entries</div></div>
      `;
    }
    const logs = await call(window.hydra.ingest.recent());
    const list = document.getElementById('recent-logs');
    if (logs) {
      list.innerHTML = logs.length
        ? logs.map(l => logEntryHtml(l, `<button class="btn btn-secondary verify-btn" data-id="${l.id}">Verify</button>`)).join('')
        : '<p class="muted">Nothing ingested yet. Head to the Ingest tab to add your first source.</p>';
      wireVerifyButtons(list);
    }
  }
  function wireVerifyButtons(container) {
    container.querySelectorAll('.verify-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = 'Checking…';
        const result = await call(window.hydra.factcheck.run(btn.dataset.id), 'Fact-check');
        btn.disabled = false; btn.textContent = 'Verify';
        if (result) { toast(`Reliability set to ${result.reliability_score}/10`, 'success'); loadDashboard(); }
      });
    });
  }

  // ---------------- Ingest ----------------
  document.getElementById('ingest-pick-file').addEventListener('click', async () => {
    const files = await call(window.hydra.ingest.chooseFiles());
    if (files && files.length) {
      document.getElementById('ingest-file-name').textContent = files[0];
      await runIngest(() => window.hydra.ingest.runFile(files[0]));
    }
  });
  document.getElementById('ingest-run-url').addEventListener('click', async () => {
    const url = document.getElementById('ingest-url').value.trim();
    if (!url) { toast('Enter a URL first.', 'error'); return; }
    await runIngest(() => window.hydra.ingest.runUrl(url));
  });
  document.getElementById('ingest-run-text').addEventListener('click', async () => {
    const text = document.getElementById('ingest-text-body').value.trim();
    const title = document.getElementById('ingest-text-title').value.trim();
    if (!text) { toast('Paste some text first.', 'error'); return; }
    await runIngest(() => window.hydra.ingest.runText({ text, title }));
  });

  async function runIngest(fn) {
    const progress = document.getElementById('ingest-progress');
    progress.classList.remove('hidden');
    const result = await call(fn(), 'Ingest');
    progress.classList.add('hidden');
    if (!result) return;
    const warnings = (result.warnings || []).map(w => `<div class="tag tag-flagged">${escapeHtml(w)}</div>`).join(' ');
    document.getElementById('ingest-result').innerHTML = `
      <div class="card">
        <h3>Ingested into "${escapeHtml(result.project)}": ${escapeHtml(result.title)}</h3>
        <p class="muted small">Type: ${escapeHtml(result.source_type)} · Entities: ${(result.primary_entities || []).join(', ') || 'none'} · Places: ${(result.related_places || []).join(', ') || 'none'}</p>
        ${result.notePath ? `<p class="muted small">Note written: ${escapeHtml(result.notePath)}</p>` : ''}
        ${result.rawCopied ? `<p class="muted small">Raw file copied into 01_Raw_Sources.</p>` : ''}
        <div>${warnings}</div>
      </div>`;
    toast('Entry ingested.', 'success');
    document.getElementById('ingest-text-body').value = '';
    document.getElementById('ingest-text-title').value = '';
    document.getElementById('ingest-url').value = '';
  }

  // ---------------- Search ----------------
  let lastSearchResult = null;
  document.getElementById('search-run').addEventListener('click', runSearch);
  document.getElementById('search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });

  function selectedPdfTemplate() {
    const el = document.querySelector('input[name="pdf-template"]:checked');
    return el ? el.value : 'simple';
  }

  async function runSearch() {
    const question = document.getElementById('search-input').value.trim();
    if (!question) { toast('Type a question first.', 'error'); return; }
    document.getElementById('search-progress').classList.remove('hidden');
    document.getElementById('search-answer').textContent = '';
    document.getElementById('search-sources').innerHTML = '';
    document.getElementById('search-export-row').classList.add('hidden');
    const result = await call(window.hydra.search.query(question), 'Search');
    document.getElementById('search-progress').classList.add('hidden');
    if (!result) return;
    lastSearchResult = { question, ...result };
    const answerBlock = document.getElementById('search-answer');
    answerBlock.innerHTML = '';
    const badge = document.createElement('div');
    badge.className = 'search-mode-badge';
    badge.textContent = `Search mode: ${result.searchMode || 'hybrid'}${result.warning ? ' · ' + result.warning : ''}`;
    const answerText = document.createElement('div');
    answerText.style.marginTop = '8px';
    answerText.textContent = result.answer;
    answerBlock.appendChild(badge);
    answerBlock.appendChild(answerText);
    document.getElementById('search-sources').innerHTML = result.sources.length
      ? '<h2>Sources</h2>' + result.sources.map(s => logEntryHtml(s, '')).join('') : '';
    if (result.sources.length) document.getElementById('search-export-row').classList.remove('hidden');
  }
  document.getElementById('search-export-pdf').addEventListener('click', async () => {
    if (!lastSearchResult) return;
    const res = await call(window.hydra.exportData.pdf({ kind: 'search', template: selectedPdfTemplate(), ...lastSearchResult }), 'Export');
    if (res && !res.canceled) toast(`Saved to ${res.filePath}`, 'success');
  });
  document.getElementById('search-export-csv').addEventListener('click', async () => {
    if (!lastSearchResult) return;
    const res = await call(window.hydra.exportData.csv({ kind: 'search', ...lastSearchResult }), 'Export');
    if (res && !res.canceled) toast(`Saved to ${res.filePath}`, 'success');
  });

  // ---------------- Entities ----------------
  let currentEntityName = null;
  async function loadEntitiesList() {
    const list = await call(window.hydra.entities.list());
    const container = document.getElementById('entities-list');
    if (!list) return;
    container.innerHTML = list.length
      ? list.map(e => `<div class="log-entry" data-name="${escapeHtml(e.name)}"><div class="log-entry-body"><div class="log-entry-title">${escapeHtml(e.name)}</div><div class="log-entry-meta">${escapeHtml(e.role || '')}</div></div></div>`).join('')
      : '<p class="muted small">No entities yet — they appear automatically as you ingest sources that mention names.</p>';
    container.querySelectorAll('.log-entry').forEach(el => el.addEventListener('click', () => loadEntityDetail(el.dataset.name)));
  }
  async function loadEntityDetail(name) {
    const entity = await call(window.hydra.entities.get(name), 'Load entity');
    if (!entity) return;
    currentEntityName = entity.name;
    document.getElementById('entity-name').value = entity.name || '';
    document.getElementById('entity-role').value = entity.role || '';
    document.getElementById('entity-org').value = entity.organization || '';
    document.getElementById('entity-summary').value = entity.summary || '';
    document.getElementById('entity-good').value = entity.good_verified || '';
    document.getElementById('entity-controversial').value = entity.controversial || '';
    document.getElementById('entity-national').value = entity.national_relations || '';
    document.getElementById('entity-international').value = entity.international_relations || '';
  }
  document.getElementById('entity-new').addEventListener('click', () => {
    currentEntityName = null;
    ['entity-name', 'entity-role', 'entity-org', 'entity-summary', 'entity-good', 'entity-controversial', 'entity-national', 'entity-international']
      .forEach(id => document.getElementById(id).value = '');
  });
  document.getElementById('entity-save').addEventListener('click', async () => {
    const entity = {
      name: document.getElementById('entity-name').value.trim(),
      role: document.getElementById('entity-role').value.trim(),
      organization: document.getElementById('entity-org').value.trim(),
      summary: document.getElementById('entity-summary').value.trim(),
      good_verified: document.getElementById('entity-good').value.trim(),
      controversial: document.getElementById('entity-controversial').value.trim(),
      national_relations: document.getElementById('entity-national').value.trim(),
      international_relations: document.getElementById('entity-international').value.trim(),
      type: 'person', status: 'Active', tags: []
    };
    if (!entity.name) { toast('An entity needs a name.', 'error'); return; }
    const res = await call(window.hydra.entities.save(entity), 'Save entity');
    if (res) { toast('Entity saved.' + (res.vaultWritten ? ' Note written.' : ''), 'success'); currentEntityName = entity.name; loadEntitiesList(); }
  });
  document.getElementById('entity-delete').addEventListener('click', async () => {
    if (!currentEntityName) { toast('Nothing selected to delete.', 'error'); return; }
    if (!confirm(`Delete the entity "${currentEntityName}"? This removes it from the database (the note file on disk is left untouched).`)) return;
    await call(window.hydra.entities.remove(currentEntityName), 'Delete entity');
    toast('Entity deleted.', 'success');
    document.getElementById('entity-new').click();
    loadEntitiesList();
  });
  document.getElementById('entity-export-pdf').addEventListener('click', async () => {
    if (!currentEntityName) { toast('Save the entity first.', 'error'); return; }
    const entity = await call(window.hydra.entities.get(currentEntityName));
    if (!entity) return;
    const res = await call(window.hydra.exportData.pdf({ kind: 'entity', template: selectedPdfTemplate(), entity }), 'Export');
    if (res && !res.canceled) toast(`Saved to ${res.filePath}`, 'success');
  });

  // ---------------- Export (bulk) ----------------
  document.getElementById('export-all-csv').addEventListener('click', async () => {
    const logs = await call(window.hydra.ingest.recent(), 'Export');
    if (!logs) return;
    const res = await call(window.hydra.exportData.csv({ kind: 'logs', logs }), 'Export');
    if (res && !res.canceled) { document.getElementById('export-status').textContent = `Saved to ${res.filePath}`; toast('Export complete.', 'success'); }
  });
  document.getElementById('export-all-xlsx').addEventListener('click', async () => {
    const logs = await call(window.hydra.ingest.recent(), 'Export');
    if (!logs) return;
    const res = await call(window.hydra.exportData.xlsx({ kind: 'logs', logs }), 'Export');
    if (res && !res.canceled) { document.getElementById('export-status').textContent = `Saved to ${res.filePath}`; toast('Export complete.', 'success'); }
  });

  // ---------------- Knowledge Graph (simple force-directed canvas) ----------------
  const graphCanvas = document.getElementById('graph-canvas');
  const gctx = graphCanvas.getContext('2d');
  let graphNodes = [];
  let graphEdges = [];
  let graphAnimHandle = null;
  let graphView = { scale: 1, offsetX: 0, offsetY: 0 };
  let dragNode = null;
  let panState = null;

  function layoutInit(nodes) {
    const w = graphCanvas.width, h = graphCanvas.height;
    nodes.forEach(n => {
      if (n.x === undefined) {
        n.x = w / 2 + (Math.random() - 0.5) * 200;
        n.y = h / 2 + (Math.random() - 0.5) * 200;
        n.vx = 0; n.vy = 0;
      }
    });
  }

  function simulateStep() {
    const w = graphCanvas.width, h = graphCanvas.height;
    const repulsion = 2200;
    const springLength = 120;
    const springStrength = 0.02;
    const damping = 0.85;

    for (let i = 0; i < graphNodes.length; i++) {
      let fx = 0, fy = 0;
      for (let j = 0; j < graphNodes.length; j++) {
        if (i === j) continue;
        const a = graphNodes[i], b = graphNodes[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const distSq = Math.max(dx * dx + dy * dy, 1);
        const force = repulsion / distSq;
        fx += (dx / Math.sqrt(distSq)) * force;
        fy += (dy / Math.sqrt(distSq)) * force;
      }
      fx += (w / 2 - graphNodes[i].x) * 0.002;
      fy += (h / 2 - graphNodes[i].y) * 0.002;
      graphNodes[i].fx = fx; graphNodes[i].fy = fy;
    }
    graphEdges.forEach(e => {
      const a = graphNodes.find(n => n.id === e.source);
      const b = graphNodes.find(n => n.id === e.target);
      if (!a || !b) return;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const force = springStrength * (dist - springLength);
      const fx = (dx / dist) * force, fy = (dy / dist) * force;
      a.fx += fx; a.fy += fy; b.fx -= fx; b.fy -= fy;
    });
    graphNodes.forEach(n => {
      if (n === dragNode) return;
      n.vx = (n.vx + n.fx) * damping;
      n.vy = (n.vy + n.fy) * damping;
      n.x += n.vx; n.y += n.vy;
    });
  }

  function drawGraph() {
    gctx.save();
    gctx.setTransform(1, 0, 0, 1, 0, 0);
    gctx.clearRect(0, 0, graphCanvas.width, graphCanvas.height);
    gctx.translate(graphView.offsetX, graphView.offsetY);
    gctx.scale(graphView.scale, graphView.scale);

    graphEdges.forEach(e => {
      const a = graphNodes.find(n => n.id === e.source);
      const b = graphNodes.find(n => n.id === e.target);
      if (!a || !b) return;
      gctx.strokeStyle = 'rgba(154,161,174,0.35)';
      gctx.lineWidth = Math.min(1 + e.weight * 0.6, 6);
      gctx.beginPath(); gctx.moveTo(a.x, a.y); gctx.lineTo(b.x, b.y); gctx.stroke();
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      gctx.fillStyle = '#9aa1ae'; gctx.font = '10px monospace';
      gctx.fillText(e.label, mx, my);
    });
    graphNodes.forEach(n => {
      gctx.beginPath();
      gctx.arc(n.x, n.y, n.known ? 16 : 11, 0, Math.PI * 2);
      gctx.fillStyle = n.known ? '#c9a227' : '#6a9b7c';
      gctx.fill();
      gctx.fillStyle = '#ede9df'; gctx.font = '12px sans-serif'; gctx.textAlign = 'center';
      gctx.fillText(n.id, n.x, n.y - (n.known ? 22 : 17));
      gctx.textAlign = 'left';
    });
    gctx.restore();
  }

  function graphLoop() {
    simulateStep();
    drawGraph();
    graphAnimHandle = requestAnimationFrame(graphLoop);
  }

  function startGraph(data) {
    if (graphAnimHandle) cancelAnimationFrame(graphAnimHandle);
    graphNodes = data.nodes.map(n => ({ ...n }));
    graphEdges = data.edges;
    layoutInit(graphNodes);
    const empty = document.getElementById('graph-empty');
    empty.classList.toggle('hidden', graphNodes.length > 0);
    graphLoop();
  }

  function canvasPoint(evt) {
    const rect = graphCanvas.getBoundingClientRect();
    const sx = (evt.clientX - rect.left - graphView.offsetX) / graphView.scale;
    const sy = (evt.clientY - rect.top - graphView.offsetY) / graphView.scale;
    return { x: sx, y: sy };
  }
  function nodeAt(pt) {
    return graphNodes.find(n => Math.hypot(n.x - pt.x, n.y - pt.y) < (n.known ? 16 : 11) + 4);
  }

  graphCanvas.addEventListener('mousedown', (e) => {
    const pt = canvasPoint(e);
    const node = nodeAt(pt);
    if (node) { dragNode = node; }
    else { panState = { startX: e.clientX, startY: e.clientY, offX: graphView.offsetX, offY: graphView.offsetY }; }
  });
  window.addEventListener('mousemove', (e) => {
    if (dragNode) { const pt = canvasPoint(e); dragNode.x = pt.x; dragNode.y = pt.y; dragNode.vx = 0; dragNode.vy = 0; }
    else if (panState) {
      graphView.offsetX = panState.offX + (e.clientX - panState.startX);
      graphView.offsetY = panState.offY + (e.clientY - panState.startY);
    }
  });
  window.addEventListener('mouseup', () => { dragNode = null; panState = null; });
  graphCanvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    graphView.scale = Math.min(Math.max(graphView.scale * (e.deltaY < 0 ? 1.08 : 0.93), 0.3), 3);
  }, { passive: false });
  graphCanvas.addEventListener('click', async (e) => {
    const pt = canvasPoint(e);
    const node = nodeAt(pt);
    if (!node) return;
    const neighbors = graphEdges.filter(edge => edge.source === node.id || edge.target === node.id)
      .map(edge => `${edge.source === node.id ? edge.target : edge.source} (${edge.label}, x${edge.weight})`);
    const detail = document.getElementById('graph-node-detail');
    detail.classList.remove('hidden');
    detail.innerHTML = `<h3>${escapeHtml(node.id)}</h3><p class="muted small">${node.known ? escapeHtml(node.role || 'Tracked entity') : 'Appears in the graph but has no saved entity profile yet.'}</p>
      <p class="muted small"><strong>Connections:</strong> ${neighbors.length ? escapeHtml(neighbors.join(', ')) : 'none'}</p>
      <button class="btn btn-secondary" id="graph-open-entity">Open in Entities</button>`;
    document.getElementById('graph-open-entity').addEventListener('click', () => {
      showView('entities');
      setTimeout(() => loadEntityDetail(node.id), 200);
    });
  });

  document.getElementById('graph-load-full').addEventListener('click', async () => {
    const data = await call(window.hydra.graph.full(), 'Load graph');
    if (data) startGraph(data);
  });
  document.getElementById('graph-load-focus').addEventListener('click', async () => {
    const name = document.getElementById('graph-focus').value.trim();
    if (!name) { toast('Type an entity name to focus on, or use "Show full graph".', 'error'); return; }
    const data = await call(window.hydra.graph.neighborhood(name), 'Load graph');
    if (data) startGraph(data);
  });

  // ---------------- Entity wiki generation ----------------
  document.getElementById('entity-wiki').addEventListener('click', async () => {
    if (!currentEntityName) { toast('Save the entity first.', 'error'); return; }
    const statusEl = document.getElementById('entity-wiki-status');
    statusEl.textContent = 'Generating wiki page from ingested sources…';
    const res = await call(window.hydra.wiki.generate(currentEntityName), 'Generate wiki');
    statusEl.textContent = res ? `Wiki page written (${res.sourceCount} source${res.sourceCount === 1 ? '' : 's'} used): ${res.wikiPath}` : '';
    if (res) toast('Wiki page generated.', 'success');
  });
  document.getElementById('entity-view-graph').addEventListener('click', async () => {
    if (!currentEntityName) { toast('Save the entity first.', 'error'); return; }
    showView('graph');
    document.getElementById('graph-focus').value = currentEntityName;
    const data = await call(window.hydra.graph.neighborhood(currentEntityName), 'Load graph');
    if (data) startGraph(data);
  });


  function toggleProviderFields(cfg) {
    document.getElementById('ollama-fields').classList.toggle('hidden', !(cfg.providers.brainProvider === 'ollama' || cfg.providers.embeddingProvider === 'ollama'));
    document.getElementById('cli-fields').classList.toggle('hidden', cfg.providers.brainProvider !== 'cli');
  }

  async function loadSettings() {
    const cfg = await call(window.hydra.config.get());
    if (!cfg) return;
    document.getElementById('status-openai').textContent = cfg.keys.openai.present ? `connected (${cfg.keys.openai.masked})` : 'not set';
    document.getElementById('status-anthropic').textContent = cfg.keys.anthropic.present ? `connected (${cfg.keys.anthropic.masked})` : 'not set';
    document.getElementById('status-tavily').textContent = cfg.keys.tavily.present ? `connected (${cfg.keys.tavily.masked})` : 'not set';
    document.getElementById('status-elevenlabs').textContent = cfg.keys.elevenlabs.present ? `connected (${cfg.keys.elevenlabs.masked})` : 'not set';
    document.getElementById('prompt-system').value = cfg.prompts.systemPrompt;
    document.getElementById('prompt-rewrite').value = cfg.prompts.rewritePrompt || '';
    document.getElementById('prompt-factcheck').value = cfg.prompts.factCheckPrompt;
    document.getElementById('prompt-entity').value = cfg.prompts.entityPrompt;
    document.getElementById('prompt-ocr').value = cfg.prompts.ocrContextPrompt;

    document.getElementById('provider-brain').value = cfg.providers.brainProvider;
    document.getElementById('provider-embedding').value = cfg.providers.embeddingProvider;
    document.getElementById('provider-transcription').value = cfg.providers.transcriptionProvider;
    document.getElementById('ollama-host').value = cfg.providers.ollamaHost;
    document.getElementById('ollama-brain-model').value = cfg.providers.ollamaBrainModel;
    document.getElementById('ollama-embed-model').value = cfg.providers.ollamaEmbeddingModel;
    document.getElementById('cli-command').value = cfg.providers.cliCommand;
    toggleProviderFields(cfg);

    renderMcpList(cfg.mcpServers || []);
    document.getElementById('settings-active-project').textContent = currentProject ? `${currentProject.name} — ${currentProject.rootPath}` : 'No project open';
  }

  ['provider-brain', 'provider-embedding'].forEach(id => {
    document.getElementById(id).addEventListener('change', async () => {
      const cfg = await call(window.hydra.config.get());
      if (cfg) {
        cfg.providers.brainProvider = document.getElementById('provider-brain').value;
        cfg.providers.embeddingProvider = document.getElementById('provider-embedding').value;
        toggleProviderFields(cfg);
      }
    });
  });

  document.getElementById('providers-save').addEventListener('click', async () => {
    const providers = {
      brainProvider: document.getElementById('provider-brain').value,
      embeddingProvider: document.getElementById('provider-embedding').value,
      transcriptionProvider: document.getElementById('provider-transcription').value,
      ollamaHost: document.getElementById('ollama-host').value.trim(),
      ollamaBrainModel: document.getElementById('ollama-brain-model').value.trim(),
      ollamaEmbeddingModel: document.getElementById('ollama-embed-model').value.trim(),
      cliCommand: document.getElementById('cli-command').value.trim(),
      pdfTemplate: selectedPdfTemplate()
    };
    const res = await call(window.hydra.config.set({ providers }), 'Save providers');
    if (res) toast('Providers saved.', 'success');
  });
  document.getElementById('test-ollama').addEventListener('click', async () => {
    const host = document.getElementById('ollama-host').value.trim();
    const statusEl = document.getElementById('status-ollama');
    statusEl.textContent = 'testing…';
    const res = await call(window.hydra.config.testOllama(host));
    statusEl.textContent = res ? `reachable ✓ (${(res.models || []).length} model(s))` : 'failed';
  });

  document.querySelectorAll('.test-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const which = btn.dataset.test;
      const key = document.getElementById(`settings-${which}-key`).value.trim();
      const statusEl = document.getElementById(`status-${which}`);
      statusEl.textContent = 'testing…';
      const testFn = { openai: window.hydra.config.testOpenAI, anthropic: window.hydra.config.testAnthropic, tavily: window.hydra.config.testTavily, elevenlabs: window.hydra.config.testElevenlabs }[which];
      const res = await call(testFn(key), `${which} test`);
      statusEl.textContent = res ? 'valid ✓' : 'failed';
    });
  });
  document.getElementById('settings-save-keys').addEventListener('click', async () => {
    const payload = {};
    const openai = document.getElementById('settings-openai-key').value.trim();
    const anthropic = document.getElementById('settings-anthropic-key').value.trim();
    const tavily = document.getElementById('settings-tavily-key').value.trim();
    const elevenlabs = document.getElementById('settings-elevenlabs-key').value.trim();
    if (openai) payload.openaiKey = openai;
    if (anthropic) payload.anthropicKey = anthropic;
    if (tavily) payload.tavilyKey = tavily;
    if (elevenlabs) payload.elevenlabsKey = elevenlabs;
    const res = await call(window.hydra.config.set(payload), 'Save connections');
    if (res) { toast('Connections saved.', 'success'); loadSettings(); }
  });

  document.getElementById('prompts-save').addEventListener('click', async () => {
    const prompts = {
      systemPrompt: document.getElementById('prompt-system').value,
      rewritePrompt: document.getElementById('prompt-rewrite').value,
      factCheckPrompt: document.getElementById('prompt-factcheck').value,
      entityPrompt: document.getElementById('prompt-entity').value,
      ocrContextPrompt: document.getElementById('prompt-ocr').value
    };
    const res = await call(window.hydra.config.set({ prompts }), 'Save prompts');
    if (res) toast('Prompts saved.', 'success');
  });
  document.getElementById('prompts-reset').addEventListener('click', async () => {
    const res = await call(window.hydra.config.resetPrompts(), 'Reset prompts');
    if (res) { toast('Prompts reset to defaults.', 'success'); loadSettings(); }
  });
  document.getElementById('open-log-btn').addEventListener('click', () => window.hydra.system.openLog());

  // ---------------- MCP servers (scaffold) ----------------
  function renderMcpList(servers) {
    const el = document.getElementById('mcp-list');
    el.innerHTML = servers.length
      ? servers.map((s, i) => `<div class="mcp-item"><span>${escapeHtml(s.name)} — ${escapeHtml(s.url)}</span><button class="btn btn-danger mcp-remove" data-i="${i}">Remove</button></div>`).join('')
      : '<p class="muted small">No MCP servers registered.</p>';
    el.querySelectorAll('.mcp-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        const cfg = await call(window.hydra.config.get());
        if (!cfg) return;
        const next = cfg.mcpServers.filter((_, i) => i !== parseInt(btn.dataset.i, 10));
        const res = await call(window.hydra.config.set({ mcpServers: next }), 'Remove MCP server');
        if (res) renderMcpList(res.mcpServers);
      });
    });
  }
  document.getElementById('mcp-add').addEventListener('click', async () => {
    const name = document.getElementById('mcp-name').value.trim();
    const url = document.getElementById('mcp-url').value.trim();
    if (!name || !url) { toast('Give the MCP server a name and URL.', 'error'); return; }
    const cfg = await call(window.hydra.config.get());
    if (!cfg) return;
    const next = [...cfg.mcpServers, { name, url }];
    const res = await call(window.hydra.config.set({ mcpServers: next }), 'Add MCP server');
    if (res) { renderMcpList(res.mcpServers); document.getElementById('mcp-name').value = ''; document.getElementById('mcp-url').value = ''; toast('Server added.', 'success'); }
  });

  // ---------------- Onboarding ----------------
  document.getElementById('ob-create-project').addEventListener('click', async () => {
    const name = prompt('Name this project:');
    if (!name || !name.trim()) return;
    const res = await call(window.hydra.projects.create(name.trim()));
    if (res) { document.getElementById('ob-project-status').textContent = `Project "${res.name}" ready.`; await refreshProjectPill(); }
  });
  document.getElementById('ob-open-project').addEventListener('click', async () => {
    const res = await call(window.hydra.projects.open());
    if (res) { document.getElementById('ob-project-status').textContent = `Opened "${res.name}".`; await refreshProjectPill(); }
  });
  document.getElementById('ob-test-openai').addEventListener('click', async () => {
    const key = document.getElementById('ob-openai-key').value.trim();
    const statusEl = document.getElementById('ob-openai-status');
    statusEl.textContent = 'testing…';
    const res = await call(window.hydra.config.testOpenAI(key));
    statusEl.textContent = res ? 'valid ✓' : 'failed';
    if (res && key) await call(window.hydra.config.set({ openaiKey: key }));
  });
  document.getElementById('ob-test-anthropic').addEventListener('click', async () => {
    const key = document.getElementById('ob-anthropic-key').value.trim();
    const statusEl = document.getElementById('ob-anthropic-status');
    statusEl.textContent = 'testing…';
    const res = await call(window.hydra.config.testAnthropic(key));
    statusEl.textContent = res ? 'valid ✓' : 'failed';
    if (res && key) await call(window.hydra.config.set({ anthropicKey: key }));
  });
  document.getElementById('ob-finish').addEventListener('click', () => {
    document.getElementById('onboarding').classList.add('hidden');
    loadDashboard();
  });

  async function maybeShowOnboarding() {
    const cfg = await call(window.hydra.config.get());
    if (!cfg) return;
    const needsOnboarding = !cfg.activeProjectPath && !cfg.keys.openai.present && !cfg.keys.anthropic.present;
    if (needsOnboarding) document.getElementById('onboarding').classList.remove('hidden');
  }

  // ---------------- Init ----------------
  (async () => {
    await refreshProjectPill();
    await maybeShowOnboarding();
    loadDashboard();
  })();
})();
