(function () {
  'use strict';

  /* ---------- helpers ---------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  const DAY = 86400000;

  let toastTimer;
  function toast(msg, isErr) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, 3200);
  }

  async function api(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    let data = {};
    try { data = await res.json(); } catch (_) { /* ignore */ }
    if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
    return data;
  }

  /* ---------- storage ---------- */
  const KEY = 'speakup.v1';
  const defaults = () => ({ days: {}, mistakes: {}, vocab: [], correct: 0, total: 0 });
  function load() {
    try { return Object.assign(defaults(), JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch (_) { return defaults(); }
  }
  let store = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (_) { /* ignore */ } }

  const dayKey = (d) => (d || new Date()).toLocaleDateString('en-CA');
  function today() {
    const k = dayKey();
    if (!store.days[k]) store.days[k] = { checks: 0, correct: 0, seconds: 0 };
    return store.days[k];
  }

  function streak() {
    let n = 0;
    const d = new Date();
    const active = (date) => { const x = store.days[dayKey(date)]; return x && (x.checks > 0 || x.seconds > 0); };
    if (!active(d)) d.setDate(d.getDate() - 1);
    while (active(d)) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  function updateStreak() { $('#streakNum').textContent = streak(); }

  function record(fb) {
    const t = today();
    t.checks++;
    store.total++;
    if (fb.verdict === 'correct') { t.correct++; store.correct++; }
    (fb.mistake_types || []).forEach((m) => {
      const k = String(m).toLowerCase().trim();
      if (k) store.mistakes[k] = (store.mistakes[k] || 0) + 1;
    });
    save();
    updateStreak();
  }

  function addSeconds(s) {
    if (s < 1) return;
    today().seconds += s;
    save();
    updateStreak();
  }

  /* ---------- speech (Young Female Voice, ~20 years old) ---------- */
  function getYoungFemaleVoice() {
    const list = speechSynthesis.getVoices();
    const prefs = ['jenny', 'ava', 'aria', 'samantha', 'victoria', 'sonia', 'ana', 'karen', 'zira', 'google us english'];
    for (const p of prefs) {
      const match = list.find((v) => v.lang.startsWith('en') && v.name.toLowerCase().includes(p) && !/(male|guy)/i.test(v.name));
      if (match) return match;
    }
    const female = list.find((v) => v.lang.startsWith('en') && /(female|woman)/i.test(v.name));
    if (female) return female;
    return list.find((v) => v.lang.startsWith('en') && !/(david|mark|guy|george|daniel|male)/i.test(v.name)) || list.find((v) => v.lang.startsWith('en'));
  }

  function speak(text, rate) {
    if (!('speechSynthesis' in window)) return toast('Text-to-speech is not supported here.', true);
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = rate || 1.02;
    u.pitch = 1.14; // Youthful female acoustic resonance
    const v = getYoungFemaleVoice();
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  }

  /* ---------- diff highlighting ---------- */
  const norm = (t) => t.toLowerCase().replace(/^[^\w']+|[^\w']+$/g, '');
  function diffHtml(a, b) {
    const A = a.trim().split(/\s+/).filter(Boolean);
    const B = b.trim().split(/\s+/).filter(Boolean);
    const n = A.length, m = B.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = norm(A[i]) === norm(B[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const ao = [], bo = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (norm(A[i]) === norm(B[j])) { ao.push(esc(A[i])); bo.push(esc(B[j])); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ao.push('<mark class="bad">' + esc(A[i]) + '</mark>'); i++; }
      else { bo.push('<mark class="good">' + esc(B[j]) + '</mark>'); j++; }
    }
    while (i < n) ao.push('<mark class="bad">' + esc(A[i++]) + '</mark>');
    while (j < m) bo.push('<mark class="good">' + esc(B[j++]) + '</mark>');
    return { orig: ao.join(' '), corr: bo.join(' ') };
  }

  /* ---------- feedback card ---------- */
  function feedbackNode(fb, original, startOpen) {
    const wrap = document.createElement('div');
    wrap.className = 'fb';
    const toggle = document.createElement('button');
    toggle.className = 'btn small fb-toggle';
    toggle.textContent = fb.verdict === 'correct' ? '✅ Check' : '❌ Check';
    const body = document.createElement('div');
    body.className = 'fb-body';

    const d = diffHtml(original, fb.corrected || original);
    const good = fb.verdict === 'correct';
    let h = '<span class="badge ' + (good ? 'good' : 'bad') + '">' + (good ? '✅ Correct' : '❌ Incorrect') + '</span>';
    h += '<div class="fb-row"><div class="fb-label">✍️ Mine</div><div class="fb-text">' + d.orig + '</div></div>';
    h += '<div class="fb-row"><div class="fb-label">✔️ Correct version <button class="icon-btn" data-say="' + esc(fb.corrected) + '">🔊</button></div><div class="fb-text">' + d.corr + '</div></div>';
    if (fb.reason_en || fb.reason_bn) {
      h += '<div class="fb-row"><div class="fb-label">💡 Why</div>';
      if (fb.reason_en) h += '<div class="fb-text">' + esc(fb.reason_en) + '</div>';
      if (fb.reason_bn) h += '<div class="fb-text bn">' + esc(fb.reason_bn) + '</div>';
      h += '</div>';
    }
    if (fb.native_alt) {
      h += '<div class="fb-row"><div class="fb-label">🗣️ Say it like a native <button class="icon-btn" data-say="' + esc(fb.native_alt) + '">🔊</button></div><div class="fb-text">' + esc(fb.native_alt) + '</div></div>';
    }
    if (fb.pronunciation_tip) h += '<div class="fb-row tip">🎯 ' + esc(fb.pronunciation_tip) + '</div>';
    if (fb.vocab && fb.vocab.length) {
      h += '<div class="fb-row"><div class="fb-label">📚 Vocabulary</div>';
      fb.vocab.forEach((v, idx) => {
        h += '<div class="vocab-item"><div><b>' + esc(v.word) + '</b><small>' + esc(v.meaning) + '</small><small><i>' + esc(v.example) + '</i></small></div>' +
          '<button class="icon-btn" data-addv="' + idx + '" title="Save to notebook">＋</button></div>';
      });
      h += '</div>';
    }
    body.innerHTML = h;

    body.addEventListener('click', (e) => {
      const say = e.target.closest('[data-say]');
      if (say) return speak(say.dataset.say);
      const add = e.target.closest('[data-addv]');
      if (add) { addVocab(fb.vocab[Number(add.dataset.addv)]); add.disabled = true; add.textContent = '✓'; }
    });
    toggle.addEventListener('click', () => {
      const open = wrap.classList.toggle('open');
      toggle.textContent = (open ? 'Hide' : (good ? '✅ Check' : '❌ Check'));
    });

    wrap.appendChild(toggle);
    wrap.appendChild(body);
    if (startOpen) { wrap.classList.add('open'); toggle.textContent = 'Hide'; }
    return wrap;
  }

  /* ---------- navigation ---------- */
  const loaded = { write: false, read: false };
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (!b) return;
    const v = b.dataset.view;
    $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
    $$('.view').forEach((x) => x.classList.toggle('active', x.id === 'view-' + v));
    window.scrollTo({ top: 0 });
    if (v === 'write' && !loaded.write) loadWrite();
    if (v === 'read' && !loaded.read) loadRead();
    if (v === 'vocab') renderVocab();
    if (v === 'progress') renderProgress();
  });

  /* ---------- SPEAKING ---------- */
  const chatEl = $('#chat');
  const chatInput = $('#chatInput');
  const sendBtn = $('#sendBtn');
  const micBtn = $('#micBtn');
  const micHint = $('#micHint');
  let history = [];
  let busy = false;
  let lastAi = '';

  function addMsg(role, text) {
    const msg = document.createElement('div');
    msg.className = 'msg ' + (role === 'ai' ? 'ai' : 'me');
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    msg.appendChild(bubble);
    chatEl.appendChild(msg);
    msg.scrollIntoView({ behavior: 'smooth', block: 'end' });
    return { msg, bubble };
  }

  function aiReplyUI(parts, text) {
    parts.bubble.textContent = text;
    parts.msg.classList.remove('typing');
    const act = document.createElement('div');
    act.className = 'msg-actions';
    const b = document.createElement('button');
    b.className = 'icon-btn';
    b.textContent = '🔊 Listen';
    b.addEventListener('click', () => speak(text));
    act.appendChild(b);
    parts.msg.appendChild(act);
  }

  function greet() {
    chatEl.innerHTML = '';
    addMsg('ai', "Hi, I'm Nova, your English speaking coach. Tap the mic and say something, or type below. After every message, tap Check to see how you did.");
    history = [];
    lastAi = '';
  }

  async function sendMessage(text) {
    text = (text || '').trim();
    if (!text || busy) return;
    busy = true;
    sendBtn.disabled = true;
    chatInput.value = '';

    const me = addMsg('me', text);
    const fbHolder = document.createElement('div');
    fbHolder.className = 'fb';
    const wait = document.createElement('button');
    wait.className = 'btn small fb-toggle';
    wait.disabled = true;
    wait.textContent = 'Checking…';
    fbHolder.appendChild(wait);
    me.msg.appendChild(fbHolder);

    const ai = addMsg('ai', 'Nova is typing…');
    ai.msg.classList.add('typing');

    history.push({ role: 'user', content: text });

    const fbP = api('/api/feedback', { text, context: lastAi })
      .then((fb) => {
        record(fb);
        fbHolder.replaceWith(feedbackNode(fb, text, false));
      })
      .catch((e) => { fbHolder.remove(); toast(e.message, true); });

    const chatP = api('/api/chat', {
      history,
      topic: $('#topicSelect').value,
      level: $('#levelSelect').value
    })
      .then((r) => {
        lastAi = r.reply;
        history.push({ role: 'assistant', content: r.reply });
        aiReplyUI(ai, r.reply);
        speak(r.reply);
      })
      .catch((e) => { ai.msg.remove(); history.pop(); toast(e.message, true); });

    await Promise.all([fbP, chatP]);
    busy = false;
    sendBtn.disabled = false;
    chatEl.lastElementChild && chatEl.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  sendBtn.addEventListener('click', () => sendMessage(chatInput.value));
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(chatInput.value); });

  $('#newChat').addEventListener('click', async () => {
    if (busy) return;
    greet();
    busy = true;
    const ai = addMsg('ai', 'Nova is typing…');
    ai.msg.classList.add('typing');
    try {
      const r = await api('/api/chat', { history: [], topic: $('#topicSelect').value, level: $('#levelSelect').value });
      lastAi = r.reply;
      history = [{ role: 'assistant', content: r.reply }];
      aiReplyUI(ai, r.reply);
      speak(r.reply);
    } catch (e) { ai.msg.remove(); toast(e.message, true); }
    busy = false;
  });

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, listening = false, listenStart = 0;
  micBtn.addEventListener('click', () => {
    if (!SR) return toast('Voice input needs Chrome or Edge. You can type instead.', true);
    if (listening) { rec.stop(); return; }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = '', lastText = '';
    rec.onstart = () => {
      listening = true;
      listenStart = Date.now();
      micBtn.classList.add('live');
      micHint.textContent = 'Listening… tap to stop';
    };
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else interim += t;
      }
      lastText = (finalText + interim).trim();
      chatInput.value = lastText;
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Microphone permission is blocked.', true);
      else if (e.error !== 'no-speech' && e.error !== 'aborted') toast('Mic error: ' + e.error, true);
    };
    rec.onend = () => {
      listening = false;
      micBtn.classList.remove('live');
      micHint.textContent = 'Tap to speak';
      addSeconds((Date.now() - listenStart) / 1000);
      const t = (finalText || lastText).trim();
      if (t) sendMessage(t); else chatInput.value = '';
    };
    try { rec.start(); } catch (_) { /* already started */ }
  });

  /* ---------- WRITING ---------- */
  let writePromptText = '';
  async function loadWrite() {
    loaded.write = true;
    $('#writePrompt').textContent = 'Loading…';
    $('#writeHint').textContent = '';
    $('#writeResult').innerHTML = '';
    $('#writeInput').value = '';
    try {
      const t = await api('/api/task', { type: 'writing', level: $('#levelSelect').value });
      writePromptText = t.prompt || '';
      $('#writePrompt').textContent = writePromptText;
      $('#writeHint').textContent = t.hint ? 'Hint: ' + t.hint : '';
    } catch (e) {
      loaded.write = false;
      $('#writePrompt').textContent = 'Could not load a task.';
      toast(e.message, true);
    }
  }
  $('#writeNew').addEventListener('click', loadWrite);
  $('#writeCheck').addEventListener('click', async () => {
    const text = $('#writeInput').value.trim();
    if (!text) return toast('Write something first.', true);
    const btn = $('#writeCheck');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    try {
      const fb = await api('/api/feedback', { text, context: writePromptText });
      record(fb);
      const box = $('#writeResult');
      box.innerHTML = '';
      box.appendChild(feedbackNode(fb, text, true));
    } catch (e) { toast(e.message, true); }
    btn.disabled = false;
    btn.textContent = 'Check my writing';
  });

  /* ---------- READING ---------- */
  let readData = null;
  async function loadRead() {
    loaded.read = true;
    $('#readTitle').textContent = 'Loading…';
    $('#readPassage').textContent = '';
    $('#readQuiz').innerHTML = '';
    try {
      readData = await api('/api/task', { type: 'reading', level: $('#levelSelect').value });
      $('#readTitle').textContent = readData.title || 'Reading';
      $('#readPassage').textContent = readData.passage || '';
      renderQuiz();
    } catch (e) {
      loaded.read = false;
      $('#readTitle').textContent = 'Could not load a passage.';
      toast(e.message, true);
    }
  }

  function renderQuiz() {
    const box = $('#readQuiz');
    box.innerHTML = '';
    (readData.questions || []).forEach((q) => {
      const p = document.createElement('div');
      p.className = 'panel q';
      const h = document.createElement('div');
      h.textContent = q.q;
      p.appendChild(h);
      const ex = document.createElement('div');
      ex.className = 'explain';
      (q.options || []).forEach((o, i) => {
        const b = document.createElement('button');
        b.className = 'opt';
        b.textContent = o;
        b.addEventListener('click', () => {
          if (p.dataset.done) return;
          p.dataset.done = '1';
          $$('.opt', p).forEach((x, k) => {
            if (k === q.answer_index) x.classList.add('right');
            else if (x === b) x.classList.add('wrong');
          });
          ex.textContent = q.explain || '';
        });
        p.appendChild(b);
      });
      p.appendChild(ex);
      box.appendChild(p);
    });
    if (readData.vocab && readData.vocab.length) {
      const p = document.createElement('div');
      p.className = 'panel';
      let h = '<div class="eyebrow">Words to learn</div>';
      readData.vocab.forEach((v, i) => {
        h += '<div class="vocab-item"><div><b>' + esc(v.word) + '</b><small>' + esc(v.meaning) + '</small><small><i>' + esc(v.example) + '</i></small></div>' +
          '<button class="icon-btn" data-addv="' + i + '">＋</button></div>';
      });
      p.innerHTML = h;
      p.addEventListener('click', (e) => {
        const add = e.target.closest('[data-addv]');
        if (add) { addVocab(readData.vocab[Number(add.dataset.addv)]); add.disabled = true; add.textContent = '✓'; }
      });
      box.appendChild(p);
    }
  }
  $('#readNew').addEventListener('click', loadRead);
  $('#readListen').addEventListener('click', () => { if (readData) speak(readData.passage, 0.9); });

  /* ---------- VOCAB ---------- */
  const INTERVALS = [0, 1, 3, 7, 14, 30];
  function addVocab(v) {
    if (!v || !v.word) return;
    const w = v.word.trim();
    if (store.vocab.some((x) => x.word.toLowerCase() === w.toLowerCase())) return toast('Already in your notebook.');
    store.vocab.push({
      id: Date.now() + Math.random(),
      word: w, meaning: v.meaning || '', example: v.example || '',
      box: 0, due: Date.now()
    });
    save();
    toast('Saved "' + w + '"');
    if ($('#view-vocab').classList.contains('active')) renderVocab();
  }

  let showAnswer = false;
  function renderVocab() {
    $('#vCount').textContent = store.vocab.length;
    const list = $('#vList');
    list.innerHTML = '';
    if (!store.vocab.length) list.innerHTML = '<li class="empty">No words yet. Save words from feedback cards or add your own.</li>';
    store.vocab.slice().reverse().forEach((v) => {
      const li = document.createElement('li');
      li.innerHTML = '<div><b>' + esc(v.word) + '</b><small>' + esc(v.meaning) + '</small>' + (v.example ? '<small><i>' + esc(v.example) + '</i></small>' : '') + '</div>' +
        '<div><button class="icon-btn" data-say="' + esc(v.word) + '">🔊</button> <button class="icon-btn" data-del="' + v.id + '">🗑</button></div>';
      list.appendChild(li);
    });
    renderReview();
  }

  $('#vList').addEventListener('click', (e) => {
    const say = e.target.closest('[data-say]');
    if (say) return speak(say.dataset.say);
    const del = e.target.closest('[data-del]');
    if (del) {
      store.vocab = store.vocab.filter((x) => String(x.id) !== del.dataset.del);
      save();
      renderVocab();
    }
  });

  function renderReview() {
    const box = $('#reviewBox');
    const due = store.vocab.filter((v) => v.due <= Date.now()).sort((a, b) => a.due - b.due);
    if (!due.length) {
      box.innerHTML = '<div class="empty">' + (store.vocab.length ? '🎉 Nothing due right now. Come back later.' : 'Your notebook is empty.') + '</div>';
      return;
    }
    const v = due[0];
    let h = '<div class="flash-sub">' + due.length + ' due</div><div class="flash">' + esc(v.word) + '</div>';
    if (!showAnswer) {
      h += '<button class="btn" id="revShow">Show answer</button>';
    } else {
      h += '<div class="flash-sub">' + esc(v.meaning) + (v.example ? '<br><i>' + esc(v.example) + '</i>' : '') + '</div>' +
        '<div class="row" style="justify-content:center"><button class="btn ghost" id="revAgain">Again</button><button class="btn" id="revGood">Got it</button></div>';
    }
    box.innerHTML = h;
    const show = $('#revShow', box);
    if (show) show.addEventListener('click', () => { showAnswer = true; speak(v.word); renderReview(); });
    const again = $('#revAgain', box);
    if (again) again.addEventListener('click', () => grade(v, false));
    const good = $('#revGood', box);
    if (good) good.addEventListener('click', () => grade(v, true));
  }

  function grade(v, ok) {
    if (ok) { v.box = Math.min(v.box + 1, INTERVALS.length - 1); v.due = Date.now() + INTERVALS[v.box] * DAY; }
    else { v.box = 0; v.due = Date.now() + 10 * 60000; }
    showAnswer = false;
    save();
    renderVocab();
  }

  $('#vAdd').addEventListener('click', () => {
    const w = $('#vWord').value.trim();
    if (!w) return toast('Enter a word.', true);
    addVocab({ word: w, meaning: $('#vMeaning').value.trim(), example: $('#vExample').value.trim() });
    $('#vWord').value = $('#vMeaning').value = $('#vExample').value = '';
  });

  /* ---------- PROGRESS ---------- */
  function renderProgress() {
    let secs = 0;
    Object.values(store.days).forEach((d) => { secs += d.seconds || 0; });
    $('#stStreak').textContent = streak();
    $('#stAcc').textContent = (store.total ? Math.round((store.correct / store.total) * 100) : 0) + '%';
    $('#stMin').textContent = (secs / 60).toFixed(1);
    $('#stChecks').textContent = store.total;

    const bars = $('#weekBars');
    bars.innerHTML = '';
    const days = [];
    for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(d); }
    const vals = days.map((d) => (store.days[dayKey(d)] || {}).checks || 0);
    const max = Math.max(1, ...vals);
    days.forEach((d, i) => {
      const el = document.createElement('div');
      el.className = 'bar';
      el.innerHTML = '<span>' + vals[i] + '</span><i style="height:' + Math.round((vals[i] / max) * 85) + '%"></i><span>' + d.toLocaleDateString('en', { weekday: 'short' }) + '</span>';
      bars.appendChild(el);
    });

    const ml = $('#mistakeList');
    const entries = Object.entries(store.mistakes).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (!entries.length) { ml.innerHTML = '<div class="empty">No mistakes tracked yet. Keep practicing.</div>'; return; }
    const top = entries[0][1];
    ml.innerHTML = entries.map(([k, v]) =>
      '<div class="mrow"><div class="mname">' + esc(k) + '</div><div class="mbar"><i style="width:' + Math.round((v / top) * 100) + '%"></i></div><div>' + v + '</div></div>'
    ).join('');
  }

  $('#resetData').addEventListener('click', () => {
    if (!confirm('Delete all progress and vocabulary from this device?')) return;
    store = defaults();
    save();
    updateStreak();
    renderProgress();
    toast('Data reset.');
  });

  /* ---------- init ---------- */
  greet();
  updateStreak();
  if ('speechSynthesis' in window) speechSynthesis.getVoices();
  fetch('/api/health').then((r) => r.json()).then((h) => {
    if (!h.hasKey) toast('Server has no ANTHROPIC_API_KEY yet. Add it to .env.', true);
  }).catch(() => {});
})();
