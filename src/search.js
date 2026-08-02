const config = require('./config');
const db = require('./db');
const embeddings = require('./embeddings');
const llm = require('./llm');

function detectEntityFilter(question) {
  const known = db.listEntities();
  const lower = question.toLowerCase();
  const match = known.find(e => lower.includes(e.name.toLowerCase()));
  return match ? match.name : null;
}

// Reciprocal Rank Fusion: merges the vector-similarity ranking and the
// keyword (FTS5/bm25) ranking into one list without needing the two
// scores to be on the same scale. k=60 is the standard RRF constant.
function reciprocalRankFusion(lists, k = 60) {
  const scores = new Map();
  const items = new Map();
  lists.forEach(list => {
    list.forEach((item, idx) => {
      const rank = idx + 1;
      const contribution = 1 / (k + rank);
      scores.set(item.id, (scores.get(item.id) || 0) + contribution);
      items.set(item.id, item);
    });
  });
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ ...items.get(id), fusedScore: score }));
}

function formatContext(results) {
  if (!results.length) return 'No matching entries were found in the database.';
  return results.map((r, i) => `[Entry ${i + 1}] (${r.source_type}, date: ${r.target_date || 'unknown'}, reliability: ${r.reliability_score}/10, flags: ${r.discrepancy_flags})
Entities: ${r.primary_entities.join(', ') || 'none'} | Places: ${r.related_places.join(', ') || 'none'}
Text: ${r.raw_text.slice(0, 1200)}`).join('\n\n');
}

async function runQuery(question) {
  if (!question || !question.trim()) throw new Error('Type a question first.');
  const cfg = config.getSafeConfig();
  const stats = db.getStats();
  if (stats.logCount === 0) {
    return { answer: 'There is nothing ingested yet. Add sources from the Ingest tab, then ask again.', sources: [] };
  }

  const entityFilter = detectEntityFilter(question);

  // Keyword search always runs (no API key needed). Vector search runs
  // too if embeddings are configured; if not, hybrid search quietly
  // degrades to keyword-only rather than failing the whole query.
  const keywordResults = db.keywordSearch(question, { topK: 15 });

  let vectorResults = [];
  let vectorWarning = null;
  try {
    const queryEmbedding = await embeddings.embedText(question);
    vectorResults = db.vectorSearch(queryEmbedding, { entity: entityFilter, topK: 15 });
  } catch (err) {
    vectorWarning = err.message;
  }

  let fused = reciprocalRankFusion([vectorResults, keywordResults]);
  if (entityFilter) {
    fused = fused.filter(r => r.primary_entities.some(e => e.toLowerCase().includes(entityFilter.toLowerCase())));
  }
  const results = fused.slice(0, 8);

  const context = formatContext(results);
  const userPrompt = `Research question: "${question}"

Retrieved context from the database:
${context}`;

  const answer = await llm.chatComplete(cfg.prompts.systemPrompt, userPrompt);

  return {
    answer,
    sources: results.map(r => ({
      id: r.id, source_type: r.source_type, target_date: r.target_date, reliability_score: r.reliability_score,
      discrepancy_flags: r.discrepancy_flags, primary_entities: r.primary_entities,
      fusedScore: Math.round(r.fusedScore * 10000) / 10000
    })),
    searchMode: vectorResults.length ? 'hybrid (vector + keyword)' : 'keyword-only (no embeddings configured)',
    warning: vectorWarning
  };
}

module.exports = { runQuery };
