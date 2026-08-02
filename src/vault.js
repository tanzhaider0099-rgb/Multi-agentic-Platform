const fs = require('fs');
const path = require('path');

function slugify(text) {
  return (text || 'untitled').toString().trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
}

function yamlArray(arr) {
  return `[${(arr || []).map(v => `"${String(v).replace(/"/g, '\\"')}"`).join(', ')}]`;
}

// Copies the original source file into 01_Raw_Sources, prefixed with a
// timestamp so nothing ever collides or gets silently overwritten —
// mirrors the naming convention from the reference ingestion script.
function copyRawFile(projectRoot, originalPath) {
  if (!originalPath || !fs.existsSync(originalPath)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.basename(originalPath);
  const destName = `${stamp}__${base}`;
  const destPath = path.join(projectRoot, '01_Raw_Sources', destName);
  fs.copyFileSync(originalPath, destPath);
  return destPath;
}

// Writes the processed, ingested note into 02_Processed_Notes with a
// unified YAML frontmatter: the id/title/type/source_raw_link/tags shape
// from the reference script, plus Hydra's research-tracking fields.
function writeProcessedNote(projectRoot, note) {
  const dir = path.join(projectRoot, '02_Processed_Notes');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${stamp}__${slugify(note.title || note.id)}.md`;
  const fullPath = path.join(dir, filename);

  const relRawLink = note.raw_file_path
    ? path.relative(projectRoot, note.raw_file_path).replace(/\\/g, '/')
    : '';

  const frontmatter = `---
id: "${note.id}"
title: "${(note.title || 'Untitled entry').replace(/"/g, '\\"')}"
type: "${note.source_type || 'Raw Input'}"
source_raw_link: "${relRawLink ? `[[${relRawLink}]]` : ''}"
source_url: "${note.source_url || ''}"
processed_date: ${new Date().toISOString().slice(0, 10)}
primary_entities: ${yamlArray(note.primary_entities)}
related_places: ${yamlArray(note.related_places)}
target_date: ${note.target_date || 'null'}
reliability_score: ${note.reliability_score ?? 5}/10
discrepancy_flags: "${note.discrepancy_flags || 'Not yet verified'}"
tags:
  - automated-ingest
---

# ${note.title || 'Untitled entry'}

${note.body || note.raw_text || ''}
`;
  fs.writeFileSync(fullPath, frontmatter, 'utf8');
  return fullPath;
}

function writeEntityMarkdown(projectRoot, entity) {
  const sub = entity.type === 'place' ? '03_Entities/Places' : '03_Entities/People';
  const fullDir = path.join(projectRoot, sub);
  if (!fs.existsSync(fullDir)) fs.mkdirSync(fullDir, { recursive: true });
  const fullPath = path.join(fullDir, `${slugify(entity.name)}.md`);

  const content = `---
type: entity/${entity.type || 'person'}
name: "${entity.name}"
role: "${entity.role || ''}"
organization: "${entity.organization || ''}"
status: "${entity.status || 'Active'}"
tags: ${yamlArray(entity.tags)}
last_updated: ${new Date().toISOString().slice(0, 10)}
---

# ${entity.name} (Research Profile)

## Executive Summary
${entity.summary || '_No summary yet._'}

## Documented & Verified
${entity.good_verified || '_Nothing recorded yet._'}

## Disputed / Under Scrutiny
${entity.controversial || '_Nothing recorded yet._'}
_Only include claims with a linked, sourced log. Unverified claims should be labeled "unverified" rather than stated as fact._

## Relations & Networks
**National:** ${entity.national_relations || '_None recorded._'}
**International:** ${entity.international_relations || '_None recorded._'}

## Sourced Evidence Log
_Populated automatically as logs mentioning this entity are ingested._
`;
  fs.writeFileSync(fullPath, content, 'utf8');
  return fullPath;
}

function writeWikiPage(projectRoot, title, content) {
  const dir = path.join(projectRoot, '05_Wiki');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fullPath = path.join(dir, `${slugify(title)}.md`);
  const frontmatter = `---
type: wiki-page
title: "${title.replace(/"/g, '\\"')}"
generated_at: ${new Date().toISOString()}
tags:
  - auto-generated-wiki
---

`;
  fs.writeFileSync(fullPath, frontmatter + content, 'utf8');
  return fullPath;
}

module.exports = { copyRawFile, writeProcessedNote, writeEntityMarkdown, writeWikiPage, slugify };
