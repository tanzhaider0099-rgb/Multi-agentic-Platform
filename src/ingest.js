const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const config = require('./config');
const projects = require('./projects');
const db = require('./db');
const vault = require('./vault');
const embeddings = require('./embeddings');
const llm = require('./llm');
const extract = require('./extract');

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp'];
const AUDIO_EXT = ['mp3', 'mp4', 'wav', 'm4a', 'mov', 'avi'];

function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function safeJsonParse(text, fallback) {
  try { return JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim()); }
  catch { return fallback; }
}

function requireActiveProject() {
  const active = projects.getActiveProject();
  if (!active) throw new Error('No project is open. Create or open a project first (top bar → Projects).');
  return active;
}

async function classify(rawText) {
  const { openai, anthropic } = config.getDecryptedKeys();
  if (!openai && !anthropic) {
    return { title: rawText.slice(0, 60), primary_entities: [], related_places: [], target_date: null, source_type: 'Raw Input', relationships: [] };
  }
  const prompt = `Read the following text and return ONLY a JSON object (no markdown fences, no commentary) with these exact fields:
{
  "title": "a short 5-8 word title for this entry",
  "primary_entities": ["names of people or organizations mentioned"],
  "related_places": ["place names mentioned"],
  "target_date": "YYYY-MM-DD date the content refers to, or null if unclear",
  "source_type": "one of: Interview, Schedule Leak, PDF, PowerPoint, Spreadsheet, Wiki, Image OCR, Tweet, Raw Input",
  "relationships": [{"source": "entity name", "target": "entity name", "relation": "a short 1-3 word relation label, e.g. WORKS_FOR, MET_WITH, MENTIONED_IN"}]
}
Only include relationships between entities that are both listed in primary_entities. If none are clear, return an empty array.

TEXT:
"""${rawText.slice(0, 6000)}"""`;
  const result = await llm.chatComplete('You extract structured metadata. Reply with raw JSON only.', prompt);
  return safeJsonParse(result, { title: rawText.slice(0, 60), primary_entities: [], related_places: [], target_date: null, source_type: 'Raw Input', relationships: [] });
}

// Optional step: rewrite raw extracted text into a clean note using the
// editable "rewritePrompt" from the Prompt Chamber. Falls back to the raw
// text untouched if no brain provider is reachable.
async function rewrite(rawText) {
  const cfg = config.getSafeConfig();
  const { openai, anthropic } = config.getDecryptedKeys();
  const provider = cfg.providers.brainProvider;
  const hasProvider = provider === 'ollama' || provider === 'cli' || openai || anthropic;
  if (!hasProvider) return rawText;
  try {
    const prompt = cfg.prompts.rewritePrompt.replace('{raw_text}', rawText.slice(0, 8000));
    return await llm.chatComplete('You rewrite raw research material into clean notes without losing facts.', prompt);
  } catch (err) {
    return rawText; // ingestion still succeeds on the raw text if rewriting fails
  }
}

async function storeLog({ rawText, sourceUrl, sourceTypeOverride, rawFilePath }) {
  if (!rawText || !rawText.trim()) throw new Error('No text content was extracted — there is nothing to store.');
  const active = requireActiveProject();

  const content_hash = hashText(rawText);
  const meta = await classify(rawText);
  const cleanedBody = await rewrite(rawText);

  let embedding = [];
  let embeddingWarning = null;
  try {
    embedding = await embeddings.embedText(rawText);
  } catch (err) {
    embeddingWarning = `Not searchable yet: ${err.message}`;
  }

  let copiedRawPath = null;
  if (rawFilePath) {
    try { copiedRawPath = vault.copyRawFile(active.rootPath, rawFilePath); }
    catch (err) { copiedRawPath = null; }
  }

  const log = {
    id: uuidv4(), content_hash, raw_text: rawText, embedding,
    source_type: sourceTypeOverride || meta.source_type || 'Raw Input',
    primary_entities: meta.primary_entities || [], related_places: meta.related_places || [],
    target_date: meta.target_date || null, source_url: sourceUrl || '',
    raw_file_path: copiedRawPath || '', reliability_score: 5, discrepancy_flags: 'Not yet verified'
  };
  db.insertLog(log);

  let notePath = null;
  try {
    notePath = vault.writeProcessedNote(active.rootPath, { ...log, title: meta.title, body: cleanedBody });
  } catch (err) {
    notePath = null;
  }

  for (const name of log.primary_entities) {
    if (!db.getEntity(name)) db.saveEntity({ name, type: 'person', status: 'Active', tags: [] });
  }

  // Graph edges: prefer the LLM-labeled relationships; for any entity pair
  // it didn't cover, fall back to a generic co-mention edge so the graph
  // still reflects everything that appeared together in this source.
  const labeledPairs = new Set();
  (meta.relationships || []).forEach(rel => {
    if (log.primary_entities.includes(rel.source) && log.primary_entities.includes(rel.target)) {
      db.upsertRelationship(rel.source, rel.target, (rel.relation || 'co-mentioned').toUpperCase().replace(/\s+/g, '_'), log.id);
      labeledPairs.add([rel.source, rel.target].sort().join('::'));
    }
  });
  for (let i = 0; i < log.primary_entities.length; i++) {
    for (let j = i + 1; j < log.primary_entities.length; j++) {
      const key = [log.primary_entities[i], log.primary_entities[j]].sort().join('::');
      if (!labeledPairs.has(key)) db.upsertRelationship(log.primary_entities[i], log.primary_entities[j], 'co-mentioned', log.id);
    }
  }

  return {
    id: log.id, title: meta.title, source_type: log.source_type,
    primary_entities: log.primary_entities, related_places: log.related_places, target_date: log.target_date,
    embeddingStored: embedding.length > 0, notePath, rawCopied: !!copiedRawPath,
    project: active.name,
    warnings: [embeddingWarning].filter(Boolean)
  };
}

async function ingestFile(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  const cfg = config.getSafeConfig();
  let rawText, sourceTypeOverride;

  if (IMAGE_EXT.includes(ext)) {
    rawText = await llm.ocrImage(filePath, cfg.prompts.ocrContextPrompt);
    sourceTypeOverride = 'Image OCR';
  } else if (AUDIO_EXT.includes(ext)) {
    rawText = await llm.transcribeAudio(filePath);
    sourceTypeOverride = 'Interview';
  } else if (ext === 'pdf') {
    rawText = await extract.extractPdf(filePath);
    sourceTypeOverride = 'PDF';
  } else if (ext === 'pptx' || ext === 'ppt') {
    if (ext === 'ppt') throw new Error('Legacy .ppt isn\'t supported — save the file as .pptx and try again.');
    rawText = await extract.extractPptx(filePath);
    sourceTypeOverride = 'PowerPoint';
  } else if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
    if (ext === 'csv') {
      rawText = require('fs').readFileSync(filePath, 'utf8');
    } else {
      rawText = await extract.extractXlsxPreview(filePath);
    }
    sourceTypeOverride = 'Spreadsheet';
  } else if (ext === 'txt' || ext === 'md') {
    rawText = extract.extractPlainText(filePath);
  } else {
    throw new Error(`Unsupported file type ".${ext}". Supported: images, audio/video, PDF, PowerPoint (.pptx), Excel/CSV, and plain text/markdown.`);
  }

  return storeLog({ rawText, sourceUrl: filePath, sourceTypeOverride, rawFilePath: filePath });
}

async function ingestUrl(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Enter a full URL starting with http:// or https://');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch that URL (status ${res.status}).`);
  const html = await res.text();
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('No readable text content was found at that URL.');
  return storeLog({ rawText: text.slice(0, 20000), sourceUrl: url, sourceTypeOverride: 'Wiki' });
}

async function ingestRawText({ text, title }) {
  if (!text || !text.trim()) throw new Error('Paste some text first.');
  return storeLog({ rawText: title ? `${title}\n\n${text}` : text, sourceUrl: '', sourceTypeOverride: 'Raw Input' });
}

module.exports = { ingestFile, ingestUrl, ingestRawText };
