'use strict';
/**
 * SpeakUp backend — zero dependencies (Node 18+).
 * Serves /public and exposes a small JSON API that talks to an LLM.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

// ---------- tiny .env loader ----------
(function loadEnv() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  } catch (_) { /* no .env, fine */ }
})();

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 100 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

// ---------- prompts ----------
const FEEDBACK_SYSTEM = `You are an expert English coach for Bangla speakers learning to speak like natives.
Evaluate the learner's sentence(s). Return ONLY one JSON object, no markdown, no extra text:
{
  "verdict": "correct" | "incorrect",
  "corrected": "natural, native-sounding fixed version (same as input if already perfect)",
  "reason_en": "one short sentence explaining the main fix, or why it is good",
  "reason_bn": "same explanation in Bangla script (বাংলা অক্ষরে), never Roman letters",
  "native_alt": "one more casual, natural way a native would say it",
  "mistake_types": ["grammar|tense|preposition|article|word choice|spelling|punctuation|word order|other"],
  "pronunciation_tip": "short tip with simple phonetics for one tricky word, or empty string",
  "vocab": [ { "word": "...", "meaning": "simple English + Bangla meaning", "example": "short example sentence" } ]
}
Rules: verdict is "correct" only if it is grammatical and natural. Keep mistake_types empty when correct. Give 2-3 vocab items related to the topic. If the learner's text is a spoken transcript, ignore missing capitalization/punctuation.`;

const CHAT_SYSTEM = `You are "Nova", a friendly native-level English speaking coach for a Bangla speaker.
Hold a natural conversation: react briefly to what the learner said (1-2 short sentences), then ask exactly ONE follow-up question. Use simple, natural spoken English. Do not correct mistakes here (a separate feedback card does that).
If the learner writes in Bangla or seems stuck, help in one short Bangla sentence (বাংলা অক্ষরে).
Return ONLY JSON: {"reply": "..."}`;

function taskSystem(type) {
  if (type === 'reading') {
    return `Create a short reading practice for an intermediate English learner (Bangla speaker). Return ONLY JSON:
{"title":"...","passage":"80-120 words, natural English","questions":[{"q":"...","options":["A","B","C","D"],"answer_index":0,"explain":"one short sentence"}],"vocab":[{"word":"...","meaning":"simple English + Bangla meaning","example":"..."}]}
Give exactly 3 questions and 3 vocab items.`;
  }
  return `Create one short writing task for an intermediate English learner (Bangla speaker). Return ONLY JSON:
{"prompt":"a clear task in 1-2 sentences, everyday topic","hint":"a helpful starter phrase or two"}`;
}

// ---------- LLM call ----------
async function callLLM(system, messages, maxTokens) {
  if (!API_KEY) {
    const e = new Error('ANTHROPIC_API_KEY is not set on the server. Copy .env.example to .env and add your key.');
    e.status = 503;
    throw e;
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens || 800, system, messages })
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    const e = new Error('LLM request failed (' + res.status + '). ' + t.slice(0, 200));
    e.status = 502;
    throw e;
  }
  const data = await res.json();
  return (data.content || []).map((b) => b.text || '').join('');
}

function extractJSON(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Model did not return JSON');
  return JSON.parse(text.slice(start, end + 1));
}

function clean(s, max) {
  return String(s == null ? '' : s).slice(0, max || 1000);
}

// ---------- route handlers ----------
const routes = {
  'POST /api/feedback': async (body) => {
    const text = clean(body.text, 600).trim();
    if (!text) throw badRequest('text is required');
    const ctx = clean(body.context, 400);
    const user = (ctx ? 'Context (question/task shown to learner): ' + ctx + '\n' : '') + 'Learner wrote: ' + text;
    const raw = await callLLM(FEEDBACK_SYSTEM, [{ role: 'user', content: user }], 900);
    const j = extractJSON(raw);
    return {
      verdict: j.verdict === 'correct' ? 'correct' : 'incorrect',
      corrected: clean(j.corrected || text, 600),
      reason_en: clean(j.reason_en, 300),
      reason_bn: clean(j.reason_bn, 400),
      native_alt: clean(j.native_alt, 400),
      mistake_types: Array.isArray(j.mistake_types) ? j.mistake_types.slice(0, 4).map((x) => clean(x, 30)) : [],
      pronunciation_tip: clean(j.pronunciation_tip, 200),
      vocab: Array.isArray(j.vocab)
        ? j.vocab.slice(0, 3).map((v) => ({ word: clean(v.word, 60), meaning: clean(v.meaning, 200), example: clean(v.example, 250) }))
        : []
    };
  },

  'POST /api/chat': async (body) => {
    const topic = clean(body.topic, 120) || 'free talk';
    const level = clean(body.level, 30) || 'intermediate';
    const goal = clean(body.goal, 60) || 'fluency';
    const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
    const msgs = history
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
      .map((m) => ({ role: m.role, content: clean(m.content, 500) }));
    if (!msgs.length || msgs[0].role !== 'user') {
      msgs.unshift({ role: 'user', content: 'Hi Nova! Let us start. Topic: ' + topic });
    }
    const sys = CHAT_SYSTEM + '\nLearner level: ' + level + '. Goal: ' + goal + '. Topic: ' + topic + '.';
    const raw = await callLLM(sys, msgs, 300);
    let reply;
    try { reply = extractJSON(raw).reply; } catch (_) { reply = raw; }
    return { reply: clean(reply, 600) };
  },

  'POST /api/task': async (body) => {
    const type = body.type === 'reading' ? 'reading' : 'writing';
    const level = clean(body.level, 30) || 'intermediate';
    const raw = await callLLM(taskSystem(type), [{ role: 'user', content: 'Level: ' + level + '. Random seed: ' + Date.now() }], 1100);
    return extractJSON(raw);
  },

  'GET /api/health': async () => ({ ok: true, hasKey: Boolean(API_KEY), model: MODEL })
};

function badRequest(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}

// ---------- simple in-memory rate limit ----------
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 40;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of hits) {
    if (!arr.some((t) => now - t < 60000)) hits.delete(ip);
  }
}, 60000).unref();

// ---------- http plumbing ----------
function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(badRequest('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const s = Buffer.concat(chunks).toString('utf8');
        resolve(s ? JSON.parse(s) : {});
      } catch (_) {
        reject(badRequest('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'x-content-type-options': 'nosniff'
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const key = req.method + ' ' + url.pathname;
  if (routes[key]) {
    const ip = req.socket.remoteAddress || 'unknown';
    if (limited(ip)) return send(res, 429, { error: 'Too many requests. Please wait a minute.' });
    try {
      const body = req.method === 'POST' ? await readBody(req) : {};
      send(res, 200, await routes[key](body));
    } catch (e) {
      send(res, e.status || 500, { error: e.message || 'Server error' });
    }
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, decodeURIComponent(url.pathname));
  res.writeHead(405);
  res.end();
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log('SpeakUp running on http://localhost:' + PORT + (API_KEY ? '' : '  (WARNING: ANTHROPIC_API_KEY not set)'));
  });
}

module.exports = { server, extractJSON };
