const Store = require('electron-store');
const { safeStorage } = require('electron');

const DEFAULT_PROMPTS = {
  systemPrompt: `You are a research intelligence assistant. Your sole purpose is to analyze the user's own database of ingested, sourced material (interviews, documents, transcripts, public web scrapes) to answer their research question.

Rules you must always follow:
- Only use the retrieved context provided to you. If the context does not answer the question, say so plainly instead of guessing.
- Never speculate about a private individual's personal safety, physical security, or unguarded moments. Do not produce content that could be used to approach, locate, or intercept a person.
- Clearly separate verified facts (high reliability_score, no discrepancy_flags) from unverified or disputed material.
- Attribute every claim to its source log where possible.

Respond using exactly these four sections, with no extra preamble:

### DIRECT ANSWER
One clear, direct sentence answering the question based on the retrieved logs.

### TIMELINE & MATRIX
A chronological list of the relevant dated events, statements, or documents found in the logs.

### PERSPECTIVES & SOURCE RELIABILITY
The different accounts or viewpoints present in the logs, and how reliable each source is based on its reliability_score and discrepancy_flags.

### RESEARCH NEXT STEPS
Concrete next steps for the researcher: what to verify further, which sources to request, what public records to check, and open questions. This section is about closing information gaps in the research — never about a person's whereabouts, schedule, or physical security.`,

  factCheckPrompt: `Search the live web for factual timelines, public records, or official statements concerning the following claim:

"{claim}"

Restrict your assessment to authoritative sources (official statements, established news organizations, public records). Note any partisan framing or unverified rumor you encounter. Report:
1. Whether the claim is supported, contradicted, or unconfirmed by public sources.
2. The most relevant supporting or contradicting sources.
3. A reliability_score from 0-10 reflecting how well the claim holds up.`,

  entityPrompt: `Summarize this entity using only publicly sourced, verifiable information: their public role, organization, and documented public activities or statements. Do not include anything about personal security, physical location patterns, home address, travel routes, or unguarded moments. Flag any claim that is not corroborated by at least one reliable source as "unverified".`,

  ocrContextPrompt: `Extract the text visible in this image exactly as written. Then, in one sentence, describe the neutral factual context of the image (e.g. "Screenshot of a public post by [account] on [platform]"). Do not infer intent, location, or anything not visibly stated in the image.`,

  rewritePrompt: `Rewrite the raw extracted text below into a clean, well-structured research note. Preserve every fact, name, date, and figure exactly — do not summarize away detail, do not invent anything not present in the source. Use clear headings and short paragraphs. Keep quotations intact where present.

RAW TEXT:
"""{raw_text}"""`
};

const DEFAULT_PROVIDERS = {
  brainProvider: 'anthropic',      // 'anthropic' | 'openai' | 'ollama' | 'cli'
  embeddingProvider: 'openai',     // 'openai' | 'ollama'
  transcriptionProvider: 'openai', // 'openai' | 'elevenlabs'
  ocrProvider: 'openai',           // 'openai' (reserved for future providers)
  ollamaHost: 'http://localhost:11434',
  ollamaBrainModel: 'llama3.1',
  ollamaEmbeddingModel: 'nomic-embed-text',
  cliCommand: '',                  // e.g. "llm -m local-model" — prompt piped via stdin, reply read from stdout
  pdfTemplate: 'simple'            // 'simple' | 'branded'
};

const store = new Store({
  name: 'hydra-config',
  defaults: {
    projects: [],           // [{ name, rootPath, createdAt }]
    activeProjectPath: '',
    supabaseUrl: '',
    supabaseKeyEnc: '',
    openaiKeyEnc: '',
    anthropicKeyEnc: '',
    tavilyKeyEnc: '',
    elevenlabsKeyEnc: '',
    keysEncrypted: false,
    prompts: DEFAULT_PROMPTS,
    providers: DEFAULT_PROVIDERS,
    mcpServers: []           // [{ name, url }] — scaffolded, not yet wired into Ask (see README)
  }
});

function canEncrypt() {
  try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
}
function encrypt(value) {
  if (!value) return '';
  if (canEncrypt()) return safeStorage.encryptString(value).toString('base64');
  return Buffer.from(value, 'utf8').toString('base64');
}
function decrypt(stored) {
  if (!stored) return '';
  try {
    if (canEncrypt()) return safeStorage.decryptString(Buffer.from(stored, 'base64'));
    return Buffer.from(stored, 'base64').toString('utf8');
  } catch { return ''; }
}
function mask(key) {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

function getSafeConfig() {
  const keys = {
    openai: decrypt(store.get('openaiKeyEnc')),
    anthropic: decrypt(store.get('anthropicKeyEnc')),
    supabase: decrypt(store.get('supabaseKeyEnc')),
    tavily: decrypt(store.get('tavilyKeyEnc')),
    elevenlabs: decrypt(store.get('elevenlabsKeyEnc'))
  };
  return {
    projects: store.get('projects'),
    activeProjectPath: store.get('activeProjectPath'),
    supabaseUrl: store.get('supabaseUrl'),
    prompts: store.get('prompts'),
    providers: { ...DEFAULT_PROVIDERS, ...store.get('providers') },
    mcpServers: store.get('mcpServers'),
    encryptionAvailable: canEncrypt(),
    keys: Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, { present: !!v, masked: mask(v) }]))
  };
}

function getDecryptedKeys() {
  return {
    openai: decrypt(store.get('openaiKeyEnc')),
    anthropic: decrypt(store.get('anthropicKeyEnc')),
    supabase: decrypt(store.get('supabaseKeyEnc')),
    tavily: decrypt(store.get('tavilyKeyEnc')),
    elevenlabs: decrypt(store.get('elevenlabsKeyEnc'))
  };
}

function setConfig(partial) {
  if (typeof partial.activeProjectPath === 'string') store.set('activeProjectPath', partial.activeProjectPath);
  if (Array.isArray(partial.projects)) store.set('projects', partial.projects);
  if (typeof partial.supabaseUrl === 'string') store.set('supabaseUrl', partial.supabaseUrl);
  if (typeof partial.openaiKey === 'string' && partial.openaiKey.length) store.set('openaiKeyEnc', encrypt(partial.openaiKey));
  if (typeof partial.anthropicKey === 'string' && partial.anthropicKey.length) store.set('anthropicKeyEnc', encrypt(partial.anthropicKey));
  if (typeof partial.supabaseKey === 'string' && partial.supabaseKey.length) store.set('supabaseKeyEnc', encrypt(partial.supabaseKey));
  if (typeof partial.tavilyKey === 'string' && partial.tavilyKey.length) store.set('tavilyKeyEnc', encrypt(partial.tavilyKey));
  if (typeof partial.elevenlabsKey === 'string' && partial.elevenlabsKey.length) store.set('elevenlabsKeyEnc', encrypt(partial.elevenlabsKey));
  if (partial.prompts && typeof partial.prompts === 'object') store.set('prompts', { ...store.get('prompts'), ...partial.prompts });
  if (partial.providers && typeof partial.providers === 'object') store.set('providers', { ...store.get('providers'), ...partial.providers });
  if (Array.isArray(partial.mcpServers)) store.set('mcpServers', partial.mcpServers);
  return getSafeConfig();
}

function resetPrompts() {
  store.set('prompts', DEFAULT_PROMPTS);
  return getSafeConfig();
}

// --- Live connection tests -------------------------------------------
async function testOpenAI(key) {
  const useKey = key || getDecryptedKeys().openai;
  if (!useKey) throw new Error('No OpenAI key provided.');
  const res = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${useKey}` } });
  if (res.status === 401) throw new Error('OpenAI rejected this key (unauthorized). Double-check it was copied in full.');
  if (!res.ok) throw new Error(`OpenAI connection test failed (status ${res.status}).`);
  return { valid: true };
}
async function testAnthropic(key) {
  const useKey = key || getDecryptedKeys().anthropic;
  if (!useKey) throw new Error('No Anthropic key provided.');
  const res = await fetch('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': useKey, 'anthropic-version': '2023-06-01' } });
  if (res.status === 401) throw new Error('Anthropic rejected this key (unauthorized). Double-check it was copied in full.');
  if (!res.ok) throw new Error(`Anthropic connection test failed (status ${res.status}).`);
  return { valid: true };
}
async function testSupabase(url, key) {
  const useUrl = url || store.get('supabaseUrl');
  const useKey = key || getDecryptedKeys().supabase;
  if (!useUrl || !useKey) throw new Error('Both the Supabase project URL and API key are required.');
  const normalized = useUrl.trim().replace(/\/+$/, '');
  const res = await fetch(`${normalized}/rest/v1/`, { headers: { apikey: useKey, Authorization: `Bearer ${useKey}` } });
  if (res.status === 401 || res.status === 403) throw new Error('Supabase rejected this key for the given project URL.');
  if (!res.ok && res.status !== 404) throw new Error(`Supabase connection test failed (status ${res.status}).`);
  return { valid: true };
}
async function testTavily(key) {
  const useKey = key || getDecryptedKeys().tavily;
  if (!useKey) throw new Error('No Tavily key provided.');
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: useKey, query: 'connection test', max_results: 1 })
  });
  if (res.status === 401 || res.status === 403) throw new Error('Tavily rejected this key.');
  if (!res.ok) throw new Error(`Tavily connection test failed (status ${res.status}).`);
  return { valid: true };
}
async function testElevenlabs(key) {
  const useKey = key || getDecryptedKeys().elevenlabs;
  if (!useKey) throw new Error('No ElevenLabs key provided.');
  const res = await fetch('https://api.elevenlabs.io/v1/user', { headers: { 'xi-api-key': useKey } });
  if (res.status === 401) throw new Error('ElevenLabs rejected this key.');
  if (!res.ok) throw new Error(`ElevenLabs connection test failed (status ${res.status}).`);
  return { valid: true };
}
async function testOllama(host) {
  const useHost = (host || store.get('providers').ollamaHost || 'http://localhost:11434').replace(/\/+$/, '');
  let res;
  try {
    res = await fetch(`${useHost}/api/tags`);
  } catch (err) {
    throw new Error(`Could not reach Ollama at ${useHost}. Is it installed and running? (ollama serve)`);
  }
  if (!res.ok) throw new Error(`Ollama responded with status ${res.status}.`);
  const json = await res.json();
  const models = (json.models || []).map(m => m.name);
  return { valid: true, models };
}

module.exports = {
  getSafeConfig, getDecryptedKeys, setConfig, resetPrompts,
  testOpenAI, testAnthropic, testSupabase, testTavily, testElevenlabs, testOllama,
  DEFAULT_PROMPTS, DEFAULT_PROVIDERS
};
