const fs = require('fs');
const { spawn } = require('child_process');
const config = require('./config');

// ---------------- Brain (analysis LLM) dispatch ----------------
// Routes to whichever provider is selected in Settings: Anthropic, OpenAI,
// a local Ollama model (fully offline), or a custom CLI command.
async function chatComplete(systemPrompt, userPrompt) {
  const cfg = config.getSafeConfig();
  const provider = cfg.providers.brainProvider;

  if (provider === 'ollama') return chatOllama(systemPrompt, userPrompt, cfg.providers);
  if (provider === 'cli') return chatCli(systemPrompt, userPrompt, cfg.providers);
  if (provider === 'openai') return chatOpenAI(systemPrompt, userPrompt);
  return chatAnthropic(systemPrompt, userPrompt); // default
}

async function chatAnthropic(systemPrompt, userPrompt) {
  const { anthropic } = config.getDecryptedKeys();
  if (!anthropic) throw new Error('Brain is set to Anthropic but no Anthropic key is configured. Add one in Settings, or switch the brain provider.');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': anthropic, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1800, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] })
  });
  if (!res.ok) { const body = await res.text().catch(() => ''); throw new Error(`Anthropic request failed (status ${res.status}). ${body.slice(0, 200)}`); }
  const json = await res.json();
  const textBlock = (json.content || []).find(b => b.type === 'text');
  return textBlock ? textBlock.text : '';
}

async function chatOpenAI(systemPrompt, userPrompt) {
  const { openai } = config.getDecryptedKeys();
  if (!openai) throw new Error('Brain is set to OpenAI but no OpenAI key is configured. Add one in Settings, or switch the brain provider.');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openai}` },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] })
  });
  if (!res.ok) { const body = await res.text().catch(() => ''); throw new Error(`OpenAI request failed (status ${res.status}). ${body.slice(0, 200)}`); }
  const json = await res.json();
  return json.choices[0].message.content;
}

// Fully offline: talks to a local Ollama server. Requires Ollama
// (https://ollama.com) installed and running, with the chosen model pulled.
async function chatOllama(systemPrompt, userPrompt, providers) {
  const host = (providers.ollamaHost || 'http://localhost:11434').replace(/\/+$/, '');
  const model = providers.ollamaBrainModel || 'llama3.1';
  let res;
  try {
    res = await fetch(`${host}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: false, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] })
    });
  } catch (err) {
    throw new Error(`Could not reach Ollama at ${host}. Make sure it's installed and running ("ollama serve"), and that model "${model}" is pulled ("ollama pull ${model}").`);
  }
  if (!res.ok) { const body = await res.text().catch(() => ''); throw new Error(`Ollama request failed (status ${res.status}). ${body.slice(0, 200)}`); }
  const json = await res.json();
  return json.message ? json.message.content : '';
}

// Fully offline / bring-your-own-tool: pipes the prompt to a local command's
// stdin and reads the reply from stdout. Whatever runs the model — a local
// CLI wrapper, a script calling another API, anything — is up to the user.
function chatCli(systemPrompt, userPrompt, providers) {
  return new Promise((resolve, reject) => {
    const command = (providers.cliCommand || '').trim();
    if (!command) return reject(new Error('Brain is set to "Custom CLI" but no command is configured in Settings.'));
    const parts = command.split(' ');
    const bin = parts[0];
    const args = parts.slice(1);
    const child = spawn(bin, args, { shell: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => reject(new Error(`Could not run CLI brain command "${command}": ${err.message}`)));
    child.on('close', (code) => {
      if (code !== 0 && !stdout.trim()) return reject(new Error(`CLI brain command exited with code ${code}. ${stderr.slice(0, 300)}`));
      resolve(stdout.trim());
    });
    child.stdin.write(`${systemPrompt}\n\n${userPrompt}\n`);
    child.stdin.end();
  });
}

// ---------------- OCR (image → text) ----------------
// OpenAI Vision only for now — see README for extending this to another provider.
async function ocrImage(filePath, contextPrompt) {
  const { openai } = config.getDecryptedKeys();
  if (!openai) throw new Error('Image analysis requires an OpenAI key (Settings → Connections). This is the only OCR provider wired up right now.');
  const buffer = fs.readFileSync(filePath);
  const ext = filePath.split('.').pop().toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const base64 = buffer.toString('base64');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openai}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: [{ type: 'text', text: contextPrompt }, { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } }] }]
    })
  });
  if (!res.ok) { const body = await res.text().catch(() => ''); throw new Error(`Image analysis failed (status ${res.status}). ${body.slice(0, 200)}`); }
  const json = await res.json();
  return json.choices[0].message.content;
}

// ---------------- Transcription (audio/video → text) ----------------
async function transcribeAudio(filePath) {
  const cfg = config.getSafeConfig();
  const provider = cfg.providers.transcriptionProvider;
  return provider === 'elevenlabs' ? transcribeElevenlabs(filePath) : transcribeWhisper(filePath);
}

async function transcribeWhisper(filePath) {
  const { openai } = config.getDecryptedKeys();
  if (!openai) throw new Error('Transcription is set to OpenAI Whisper but no OpenAI key is configured.');
  const stats = fs.statSync(filePath);
  if (stats.size > 25 * 1024 * 1024) throw new Error('This file is over 25MB. Whisper\'s API caps uploads at 25MB — split or compress the file first and try again.');
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(filePath)]), filePath.split(/[\\/]/).pop());
  form.append('model', 'whisper-1');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${openai}` }, body: form });
  if (!res.ok) { const body = await res.text().catch(() => ''); throw new Error(`Transcription failed (status ${res.status}). ${body.slice(0, 200)}`); }
  const json = await res.json();
  return json.text;
}

async function transcribeElevenlabs(filePath) {
  const { elevenlabs } = config.getDecryptedKeys();
  if (!elevenlabs) throw new Error('Transcription is set to ElevenLabs but no ElevenLabs key is configured.');
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(filePath)]), filePath.split(/[\\/]/).pop());
  form.append('model_id', 'scribe_v1');
  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': elevenlabs }, body: form });
  if (!res.ok) { const body = await res.text().catch(() => ''); throw new Error(`ElevenLabs transcription failed (status ${res.status}). ${body.slice(0, 200)}`); }
  const json = await res.json();
  return json.text || json.transcript || '';
}

module.exports = { chatComplete, ocrImage, transcribeAudio };
