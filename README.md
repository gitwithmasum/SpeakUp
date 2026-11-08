# SpeakUp

Learn English like a native, built for Bangla speakers. Speak, write, read and build vocabulary, with instant feedback after every sentence.

## Features

- **Speaking**: talk to "Nova" by mic (Web Speech API) or keyboard. Nova answers by voice.
- **Check button on every message**: expands to show a Correct/Incorrect badge, your sentence with errors highlighted, the corrected native version, a short explanation (English + বাংলা), a more natural alternative, a pronunciation tip, and vocabulary. A 🔊 button reads sentences aloud.
- **Writing**: AI-generated tasks with the same feedback card.
- **Reading**: short passages, listen mode, comprehension quiz, words to learn.
- **Vocabulary notebook**: save words, spaced-repetition review.
- **Progress**: daily streak, accuracy, speaking minutes, 7-day chart, common mistakes.

Progress and vocabulary are stored in the browser (localStorage). No database needed.

## Run

Requires Node.js 18+. No npm install needed (zero dependencies).

```bash
cp .env.example .env     # then put your ANTHROPIC_API_KEY inside
npm start
```

Open http://localhost:3000. For voice input use Chrome or Edge.

## API

| Route | Purpose |
|-------|---------|
| `POST /api/feedback` | `{text, context}` returns `{verdict, corrected, reason_en, reason_bn, native_alt, mistake_types, pronunciation_tip, vocab[]}` |
| `POST /api/chat` | `{history, topic, level}` returns `{reply}` |
| `POST /api/task` | `{type: "writing" \| "reading", level}` returns a task |
| `GET /api/health` | server status |

## Project structure

```
SpeakUp/
├── server.js          # Node server + LLM API
├── package.json
├── .env.example
└── public/
    ├── index.html
    ├── css/style.css
    └── js/app.js
```

## Deploy note

The API key stays on the server. Do not put it in frontend code. Host on any Node host (Render, Railway, Fly.io, a VPS).
