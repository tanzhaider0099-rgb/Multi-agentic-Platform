const config = require('./config');
const db = require('./db');
const projects = require('./projects');
const vault = require('./vault');
const llm = require('./llm');

// Synthesizes everything Hydra knows about one entity — its profile,
// every log that mentions it, and its graph relationships — into a
// single wiki-style overview page. This is a local, honest version of
// the "community summary" idea: one entity's summary, generated on
// demand from what's actually been ingested, not a pre-computed cluster
// over an entire enterprise corpus.
async function generateEntityWiki(name) {
  const entity = db.getEntity(name);
  if (!entity) throw new Error(`No entity named "${name}" was found.`);
  const active = projects.getActiveProject();
  if (!active) throw new Error('No project is open.');

  const logs = db.getLogsMentioningEntity(name, 30);
  const neighbors = db.getEntityNeighbors(name);

  const logSummaryBlock = logs.length
    ? logs.map((l, i) => `[${i + 1}] (${l.source_type}, ${l.target_date || 'undated'}, reliability ${l.reliability_score}/10${l.discrepancy_flags !== 'None' ? ', FLAGGED: ' + l.discrepancy_flags : ''})\n${l.raw_text.slice(0, 800)}`).join('\n\n')
    : 'No ingested logs mention this entity yet.';

  const relBlock = neighbors.length
    ? neighbors.map(n => `- ${name} —[${n.relation_type}]— ${n.neighbor} (seen together ${n.weight}x)`).join('\n')
    : 'No relationships recorded yet.';

  const cfg = config.getSafeConfig();
  const prompt = `Write a wiki-style overview page for "${name}" using only the material below. Structure it with headings: Overview, Timeline of documented mentions, Relationships, Open questions / gaps. Do not invent facts not present in the source material below. Do not include anything about physical security, location patterns, or movement — only publicly documented activity and claims, each attributed to its source number.

SOURCE LOGS MENTIONING ${name}:
${logSummaryBlock}

KNOWN RELATIONSHIPS:
${relBlock}

ENTITY PROFILE ON FILE:
Role: ${entity.role || 'unknown'} | Organization: ${entity.organization || 'unknown'}
Summary on file: ${entity.summary || 'none yet'}`;

  const wikiBody = await llm.chatComplete('You write neutral, well-sourced wiki-style overview pages from research material. Every claim must trace back to a numbered source log.', prompt);

  const wikiPath = vault.writeWikiPage(active.rootPath, name, `# ${name}\n\n${wikiBody}`);
  return { name, wikiPath, sourceCount: logs.length };
}

module.exports = { generateEntityWiki };
