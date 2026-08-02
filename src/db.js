const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS logs (
  id TEXT PRIMARY KEY,
  content_hash TEXT UNIQUE,
  raw_text TEXT NOT NULL,
  embedding TEXT,
  source_type TEXT,
  primary_entities TEXT,
  related_places TEXT,
  target_date TEXT,
  source_url TEXT,
  raw_file_path TEXT,
  reliability_score INTEGER DEFAULT 5,
  discrepancy_flags TEXT DEFAULT 'None',
  vault_path TEXT,
  recorded_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS entities (
  name TEXT PRIMARY KEY,
  type TEXT DEFAULT 'person',
  role TEXT,
  organization TEXT,
  status TEXT,
  tags TEXT,
  summary TEXT,
  good_verified TEXT,
  controversial TEXT,
  national_relations TEXT,
  international_relations TEXT,
  vault_path TEXT,
  last_updated TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_logs_date ON logs(target_date);

CREATE VIRTUAL TABLE IF NOT EXISTS logs_fts USING fts5(
  raw_text, primary_entities, related_places,
  content='logs', content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS logs_ai AFTER INSERT ON logs BEGIN
  INSERT INTO logs_fts(rowid, raw_text, primary_entities, related_places)
  VALUES (new.rowid, new.raw_text, new.primary_entities, new.related_places);
END;
CREATE TRIGGER IF NOT EXISTS logs_ad AFTER DELETE ON logs BEGIN
  INSERT INTO logs_fts(logs_fts, rowid, raw_text, primary_entities, related_places)
  VALUES ('delete', old.rowid, old.raw_text, old.primary_entities, old.related_places);
END;
CREATE TRIGGER IF NOT EXISTS logs_au AFTER UPDATE ON logs BEGIN
  INSERT INTO logs_fts(logs_fts, rowid, raw_text, primary_entities, related_places)
  VALUES ('delete', old.rowid, old.raw_text, old.primary_entities, old.related_places);
  INSERT INTO logs_fts(rowid, raw_text, primary_entities, related_places)
  VALUES (new.rowid, new.raw_text, new.primary_entities, new.related_places);
END;

CREATE TABLE IF NOT EXISTS relationships (
  id TEXT PRIMARY KEY,
  entity_a TEXT NOT NULL,
  entity_b TEXT NOT NULL,
  relation_type TEXT DEFAULT 'co-mentioned',
  log_id TEXT,
  weight INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(entity_a, entity_b, relation_type)
);
CREATE INDEX IF NOT EXISTS idx_rel_a ON relationships(entity_a);
CREATE INDEX IF NOT EXISTS idx_rel_b ON relationships(entity_b);
`;

// One SQLite connection per project, cached by root path so switching
// projects mid-session doesn't reopen the file on every call.
const connections = new Map();

function activeDb() {
  const cfg = config.getSafeConfig();
  const rootPath = cfg.activeProjectPath;
  if (!rootPath) {
    throw new Error('No project is open. Create or open a project first (top bar → Projects).');
  }
  if (connections.has(rootPath)) return connections.get(rootPath);

  const dbPath = path.join(rootPath, '.hydra', 'hydra.sqlite');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  // Migration safety net: if this project's database predates the FTS5
  // table, backfill it once so existing entries become keyword-searchable.
  const logCount = db.prepare(`SELECT COUNT(*) c FROM logs`).get().c;
  const ftsCount = db.prepare(`SELECT COUNT(*) c FROM logs_fts`).get().c;
  if (logCount > 0 && ftsCount === 0) {
    db.exec(`INSERT INTO logs_fts(rowid, raw_text, primary_entities, related_places) SELECT rowid, raw_text, primary_entities, related_places FROM logs`);
  }

  connections.set(rootPath, db);
  return db;
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function insertLog(log) {
  const db = activeDb();
  const stmt = db.prepare(`
    INSERT INTO logs (id, content_hash, raw_text, embedding, source_type, primary_entities, related_places, target_date, source_url, raw_file_path, reliability_score, discrepancy_flags, vault_path, recorded_at)
    VALUES (@id, @content_hash, @raw_text, @embedding, @source_type, @primary_entities, @related_places, @target_date, @source_url, @raw_file_path, @reliability_score, @discrepancy_flags, @vault_path, @recorded_at)
    ON CONFLICT(content_hash) DO UPDATE SET
      reliability_score=excluded.reliability_score,
      discrepancy_flags=excluded.discrepancy_flags
  `);
  stmt.run({
    id: log.id,
    content_hash: log.content_hash,
    raw_text: log.raw_text,
    embedding: JSON.stringify(log.embedding || []),
    source_type: log.source_type || 'Raw Input',
    primary_entities: JSON.stringify(log.primary_entities || []),
    related_places: JSON.stringify(log.related_places || []),
    target_date: log.target_date || null,
    source_url: log.source_url || '',
    raw_file_path: log.raw_file_path || '',
    reliability_score: log.reliability_score ?? 5,
    discrepancy_flags: log.discrepancy_flags || 'None',
    vault_path: log.vault_path || '',
    recorded_at: new Date().toISOString()
  });
  return log.id;
}

function updateReliability(id, reliability_score, discrepancy_flags) {
  activeDb().prepare(`UPDATE logs SET reliability_score = ?, discrepancy_flags = ? WHERE id = ?`).run(reliability_score, discrepancy_flags, id);
}

function getLogById(id) {
  return activeDb().prepare(`SELECT * FROM logs WHERE id = ?`).get(id);
}

function getRecentLogs(limit = 50) {
  const rows = activeDb().prepare(`SELECT id, source_type, primary_entities, related_places, target_date, reliability_score, discrepancy_flags, recorded_at, raw_file_path, substr(raw_text,1,180) as preview FROM logs ORDER BY recorded_at DESC LIMIT ?`).all(limit);
  return rows.map(r => ({ ...r, primary_entities: JSON.parse(r.primary_entities || '[]'), related_places: JSON.parse(r.related_places || '[]') }));
}

function vectorSearch(queryEmbedding, { entity, topK = 8 } = {}) {
  let rows = activeDb().prepare(`SELECT * FROM logs`).all();
  if (entity) {
    rows = rows.filter(r => JSON.parse(r.primary_entities || '[]').some(e => e.toLowerCase().includes(entity.toLowerCase())));
  }
  const scored = rows
    .map(r => {
      const emb = JSON.parse(r.embedding || '[]');
      const sim = emb.length && emb.length === queryEmbedding.length ? cosineSimilarity(emb, queryEmbedding) : 0;
      return { ...r, similarity: sim };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
  return scored.map(r => ({
    id: r.id, raw_text: r.raw_text, source_type: r.source_type,
    primary_entities: JSON.parse(r.primary_entities || '[]'), related_places: JSON.parse(r.related_places || '[]'),
    target_date: r.target_date, source_url: r.source_url, reliability_score: r.reliability_score,
    discrepancy_flags: r.discrepancy_flags, similarity: r.similarity
  }));
}

function keywordSearch(query, { topK = 8 } = {}) {
  const db = activeDb();
  // FTS5 MATCH needs simple tokens; strip characters that break the query syntax.
  const safeQuery = query.replace(/["*^]/g, ' ').trim();
  if (!safeQuery) return [];
  let rows;
  try {
    rows = db.prepare(`
      SELECT logs.*, bm25(logs_fts) as rank
      FROM logs_fts JOIN logs ON logs.rowid = logs_fts.rowid
      WHERE logs_fts MATCH ?
      ORDER BY rank LIMIT ?
    `).all(safeQuery, topK);
  } catch (err) {
    return []; // malformed FTS query (rare edge cases) — hybrid search just falls back to vector-only
  }
  return rows.map(r => ({
    id: r.id, raw_text: r.raw_text, source_type: r.source_type,
    primary_entities: JSON.parse(r.primary_entities || '[]'), related_places: JSON.parse(r.related_places || '[]'),
    target_date: r.target_date, source_url: r.source_url, reliability_score: r.reliability_score,
    discrepancy_flags: r.discrepancy_flags, rank: r.rank
  }));
}

// --- Knowledge graph -------------------------------------------------
function upsertRelationship(entityA, entityB, relationType, logId) {
  if (!entityA || !entityB || entityA === entityB) return;
  // Store edges in a stable order so A-B and B-A collapse to one row.
  const [a, b] = [entityA, entityB].sort();
  const db = activeDb();
  const existing = db.prepare(`SELECT id, weight FROM relationships WHERE entity_a = ? AND entity_b = ? AND relation_type = ?`).get(a, b, relationType || 'co-mentioned');
  if (existing) {
    db.prepare(`UPDATE relationships SET weight = weight + 1 WHERE id = ?`).run(existing.id);
  } else {
    db.prepare(`INSERT INTO relationships (id, entity_a, entity_b, relation_type, log_id, weight) VALUES (?, ?, ?, ?, ?, 1)`)
      .run(`${a}::${b}::${relationType || 'co-mentioned'}`, a, b, relationType || 'co-mentioned', logId || '');
  }
}

function getGraph() {
  const db = activeDb();
  const entities = db.prepare(`SELECT name, type, role FROM entities`).all();
  const edges = db.prepare(`SELECT entity_a, entity_b, relation_type, weight FROM relationships`).all();
  const nodeNames = new Set(entities.map(e => e.name));
  edges.forEach(e => { nodeNames.add(e.entity_a); nodeNames.add(e.entity_b); });
  const nodes = [...nodeNames].map(name => {
    const known = entities.find(e => e.name === name);
    return { id: name, type: known ? known.type : 'person', role: known ? known.role : '', known: !!known };
  });
  return { nodes, edges: edges.map(e => ({ source: e.entity_a, target: e.entity_b, label: e.relation_type, weight: e.weight })) };
}

function getEntityNeighbors(name) {
  const db = activeDb();
  const rows = db.prepare(`SELECT entity_a, entity_b, relation_type, weight FROM relationships WHERE entity_a = ? OR entity_b = ?`).all(name, name);
  return rows.map(r => ({ neighbor: r.entity_a === name ? r.entity_b : r.entity_a, relation_type: r.relation_type, weight: r.weight }));
}

function getLogsMentioningEntity(name, limit = 50) {
  const db = activeDb();
  const rows = db.prepare(`SELECT * FROM logs`).all();
  return rows
    .filter(r => JSON.parse(r.primary_entities || '[]').some(e => e.toLowerCase() === name.toLowerCase()))
    .slice(0, limit)
    .map(r => ({ ...r, primary_entities: JSON.parse(r.primary_entities || '[]'), related_places: JSON.parse(r.related_places || '[]') }));
}

function getStats() {
  const db = activeDb();
  const logCount = db.prepare(`SELECT COUNT(*) c FROM logs`).get().c;
  const entityCount = db.prepare(`SELECT COUNT(*) c FROM entities`).get().c;
  const avgReliability = db.prepare(`SELECT AVG(reliability_score) a FROM logs`).get().a;
  const flagged = db.prepare(`SELECT COUNT(*) c FROM logs WHERE discrepancy_flags != 'None'`).get().c;
  return { logCount, entityCount, avgReliability: avgReliability ? Math.round(avgReliability * 10) / 10 : null, flagged };
}

function listEntities() {
  return activeDb().prepare(`SELECT name, type, role, organization, status, last_updated FROM entities ORDER BY last_updated DESC`).all();
}
function getEntity(name) {
  const row = activeDb().prepare(`SELECT * FROM entities WHERE name = ?`).get(name);
  if (!row) return null;
  return { ...row, tags: JSON.parse(row.tags || '[]') };
}
function saveEntity(entity) {
  const stmt = activeDb().prepare(`
    INSERT INTO entities (name, type, role, organization, status, tags, summary, good_verified, controversial, national_relations, international_relations, vault_path, last_updated)
    VALUES (@name, @type, @role, @organization, @status, @tags, @summary, @good_verified, @controversial, @national_relations, @international_relations, @vault_path, @last_updated)
    ON CONFLICT(name) DO UPDATE SET
      type=excluded.type, role=excluded.role, organization=excluded.organization, status=excluded.status,
      tags=excluded.tags, summary=excluded.summary, good_verified=excluded.good_verified,
      controversial=excluded.controversial, national_relations=excluded.national_relations,
      international_relations=excluded.international_relations, vault_path=excluded.vault_path,
      last_updated=excluded.last_updated
  `);
  stmt.run({
    name: entity.name, type: entity.type || 'person', role: entity.role || '', organization: entity.organization || '',
    status: entity.status || 'Active', tags: JSON.stringify(entity.tags || []), summary: entity.summary || '',
    good_verified: entity.good_verified || '', controversial: entity.controversial || '',
    national_relations: entity.national_relations || '', international_relations: entity.international_relations || '',
    vault_path: entity.vault_path || '', last_updated: new Date().toISOString()
  });
  return entity.name;
}
function deleteEntity(name) {
  activeDb().prepare(`DELETE FROM entities WHERE name = ?`).run(name);
  return true;
}

// Closes and drops a cached connection — used when a project is removed
// from the list so its file isn't left locked.
function closeConnection(rootPath) {
  const db = connections.get(rootPath);
  if (db) { db.close(); connections.delete(rootPath); }
}

module.exports = {
  insertLog, updateReliability, getLogById, getRecentLogs, vectorSearch, keywordSearch, getStats,
  listEntities, getEntity, saveEntity, deleteEntity, closeConnection,
  upsertRelationship, getGraph, getEntityNeighbors, getLogsMentioningEntity
};
