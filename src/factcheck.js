const config = require('./config');
const db = require('./db');
const llm = require('./llm');

async function tavilySearch(query) {
  const { tavily } = config.getDecryptedKeys();
  if (!tavily) {
    throw new Error('No Tavily key configured. Add one in Settings → Prompt Chamber to enable live fact-checking. Without it, entries stay marked "Not yet verified".');
  }
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: tavily, query, max_results: 5, search_depth: 'advanced' })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Tavily search failed (status ${res.status}). ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return (json.results || []).map(r => `- ${r.title}: ${r.content?.slice(0, 300)} (${r.url})`).join('\n');
}

async function verifyLog(logId) {
  const log = db.getLogById(logId);
  if (!log) throw new Error('That entry no longer exists.');
  const cfg = config.getSafeConfig();

  const claimPrompt = cfg.prompts.factCheckPrompt.replace('{claim}', log.raw_text.slice(0, 500));

  const webResults = await tavilySearch(log.raw_text.slice(0, 300));

  const judgePrompt = `${claimPrompt}

LIVE WEB SEARCH RESULTS:
${webResults}

Respond ONLY with a JSON object (no markdown fences): { "reliability_score": <0-10 integer>, "discrepancy_flags": "<'None' or a short explanation of the conflict>" }`;

  const verdictRaw = await llm.chatComplete('You are a careful fact-checker. Reply with raw JSON only.', judgePrompt);
  let verdict;
  try {
    verdict = JSON.parse(verdictRaw.replace(/```json/g, '').replace(/```/g, '').trim());
  } catch {
    throw new Error('The fact-check model returned an unexpected format. Try again — no changes were saved.');
  }

  const score = Math.max(0, Math.min(10, parseInt(verdict.reliability_score, 10) || 5));
  const flags = verdict.discrepancy_flags || 'None';

  db.updateReliability(logId, score, flags);

  return { id: logId, reliability_score: score, discrepancy_flags: flags, webResults };
}

module.exports = { verifyLog };
