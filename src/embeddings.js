const config = require('./config');

async function embedText(text) {
  const cfg = config.getSafeConfig();
  if (cfg.providers.embeddingProvider === 'ollama') return embedOllama(text, cfg.providers);
  return embedOpenAI(text);
}

async function embedOpenAI(text) {
  const { openai } = config.getDecryptedKeys();
  if (!openai) throw new Error('Embeddings are set to OpenAI but no key is configured. Add one in Settings, or switch to the offline Ollama embedding provider.');
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openai}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 30000) })
  });
  if (!res.ok) { const body = await res.text().catch(() => ''); throw new Error(`Embedding request failed (status ${res.status}). ${body.slice(0, 200)}`); }
  const json = await res.json();
  return json.data[0].embedding;
}

// Fully offline embeddings via a local Ollama embedding model (e.g. nomic-embed-text).
async function embedOllama(text, providers) {
  const host = (providers.ollamaHost || 'http://localhost:11434').replace(/\/+$/, '');
  const model = providers.ollamaEmbeddingModel || 'nomic-embed-text';
  let res;
  try {
    res = await fetch(`${host}/api/embeddings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text.slice(0, 30000) })
    });
  } catch (err) {
    throw new Error(`Could not reach Ollama at ${host} for embeddings. Make sure it's running and "${model}" is pulled ("ollama pull ${model}").`);
  }
  if (!res.ok) { const body = await res.text().catch(() => ''); throw new Error(`Ollama embedding request failed (status ${res.status}). ${body.slice(0, 200)}`); }
  const json = await res.json();
  return json.embedding || [];
}

module.exports = { embedText };
