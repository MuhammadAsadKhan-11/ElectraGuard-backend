# RAG for the ElectraGuard Chatbot

This folder adds Retrieval-Augmented Generation to the `/chat` endpoint using
publicly available info from Pakistan's electricity utilities (DISCOs),
NEPRA, WAPDA, and K-Electric.

## How it works

```
scrape_sources.py  →  knowledge_base/*.txt  →  build_index.py  →  index/knowledge_index.json
                                                                          │
                                                                          ▼
                                              server.js loads it at startup, and on every
                                              /chat request: embeds the question → cosine
                                              similarity search → top-k chunks → sent to
                                              Gemini as context → grounded answer
```

## One-time setup (run on your own machine, not on Render)

```bash
cd rag/scripts
pip install -r requirements.txt

# 1. Scrape the DISCO/NEPRA/WAPDA/K-Electric pages listed in scrape_sources.py
python scrape_sources.py

# 2. Embed + build the searchable index (needs GEMINI_API_KEY)
export GEMINI_API_KEY=your_key_here
python build_index.py
```

This produces `rag/index/knowledge_index.json`. Commit that file (or upload it)
alongside the rest of `gemini-backend/` when you deploy to Render — `server.js`
loads it automatically on startup via `loadKnowledgeBase()`.

## Updating the knowledge base later

Re-run both scripts any time you want to add more pages or refresh stale
content (tariffs change often — NEPRA notifies new rates regularly). Just
add more `(name, url)` entries to `SOURCES` in `scrape_sources.py` first.

## Folder layout

```
rag/
├── knowledge_base/        # raw scraped .txt files (created by scrape_sources.py)
├── index/
│   └── knowledge_index.json   # chunked + embedded knowledge (created by build_index.py)
├── retriever.js            # Node.js cosine-similarity search, used by server.js
├── scripts/
│   ├── scrape_sources.py
│   ├── build_index.py
│   └── requirements.txt
└── README.md               # this file
```

## Notes

- If `knowledge_index.json` doesn't exist, the chatbot still works — it just
  answers from Gemini's general knowledge with no retrieval, and logs a
  warning on startup.
- The retriever ignores weak matches (cosine similarity < 0.55) so the model
  isn't forced to use irrelevant context for off-topic questions.
- Response from `/chat` now includes a `sources` array (e.g. `["lesco_home",
  "nepra_home"]`) so the frontend can optionally show "Sources: LESCO,
  NEPRA" under the chatbot's answer if you want.
- Scraped page content belongs to the respective utility/government sites.
  Treat it as reference data for grounding answers, not as content to
  republish elsewhere.
