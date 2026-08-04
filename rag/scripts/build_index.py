"""
build_index.py
──────────────────────────────────────────────────────────────────────────
Reads every .txt file in rag/knowledge_base/, splits it into overlapping
chunks, embeds each chunk with Gemini's gemini-embedding-001 model, and
writes rag/index/knowledge_index.json — a flat list of
{ text, source, embedding } objects that the Node.js chatbot backend
loads at startup and searches with cosine similarity.

Run this on your own machine after scrape_sources.py:

    pip install -r requirements.txt
    export GEMINI_API_KEY=your_key_here        (or put it in a .env file here)
    python build_index.py

Re-run this any time you add/update files in knowledge_base/ — then
redeploy the gemini-backend service so it picks up the new index.

RESUMABLE: if the script is interrupted (e.g. rate-limited) partway through,
just run it again — chunks that are already in knowledge_index.json are
skipped instead of re-embedded, so you don't waste quota re-doing work
that already succeeded.

NOTE: this uses the current `google-genai` SDK (the old `google-generativeai`
package is deprecated and no longer works with current models).
"""

import os
import json
import glob
import time
from dotenv import load_dotenv
from google import genai
from google.genai import types
from google.genai.errors import ClientError

load_dotenv()

API_KEY = os.environ.get("GEMINI_API_KEY")
if not API_KEY:
    raise RuntimeError("Set GEMINI_API_KEY in your environment or a .env file before running this.")

client = genai.Client(api_key=API_KEY)

BASE_DIR = os.path.dirname(__file__)
KB_DIR = os.path.join(BASE_DIR, "..", "knowledge_base")
INDEX_DIR = os.path.join(BASE_DIR, "..", "index")
INDEX_PATH = os.path.join(INDEX_DIR, "knowledge_index.json")
os.makedirs(INDEX_DIR, exist_ok=True)

EMBED_MODEL = "gemini-embedding-001"
EMBED_DIMENSIONS = 768   # smaller = cheaper/faster to store+search; plenty for this use case
CHUNK_SIZE = 400         # words per chunk
CHUNK_OVERLAP = 60       # words of overlap between consecutive chunks

REQUEST_DELAY = 2.0      # seconds between embedding calls — free tier is rate-limited per minute
MAX_RETRIES = 5          # on 429, retry with growing backoff instead of giving up


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP):
    words = text.split()
    if not words:
        return []
    step = max(chunk_size - overlap, 1)
    chunks = []
    for i in range(0, len(words), step):
        chunk = " ".join(words[i:i + chunk_size])
        if len(chunk.strip()) > 0:
            chunks.append(chunk)
        if i + chunk_size >= len(words):
            break
    return chunks


def load_existing_index():
    """Returns {id: record} for chunks already embedded in a previous run."""
    if not os.path.exists(INDEX_PATH):
        return {}
    try:
        with open(INDEX_PATH, "r", encoding="utf-8") as f:
            records = json.load(f)
        return {r["id"]: r for r in records}
    except Exception:
        return {}


def embed_with_retry(text: str):
    delay = 20  # seconds — free tier quota windows are typically per-minute
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            result = client.models.embed_content(
                model=EMBED_MODEL,
                contents=text,
                config=types.EmbedContentConfig(
                    task_type="RETRIEVAL_DOCUMENT",
                    output_dimensionality=EMBED_DIMENSIONS,
                ),
            )
            return result.embeddings[0].values
        except ClientError as e:
            is_rate_limit = getattr(e, "code", None) == 429 or "RESOURCE_EXHAUSTED" in str(e)
            if is_rate_limit and attempt < MAX_RETRIES:
                print(f"    Rate limited — waiting {delay}s before retry {attempt}/{MAX_RETRIES}...")
                time.sleep(delay)
                delay *= 2  # exponential backoff
                continue
            raise


def main():
    files = sorted(glob.glob(os.path.join(KB_DIR, "*.txt")))
    if not files:
        print(f"No .txt files found in {os.path.abspath(KB_DIR)}. "
              f"Run scrape_sources.py first (or add files manually).")
        return

    existing = load_existing_index()
    if existing:
        print(f"Resuming: {len(existing)} chunks already embedded from a previous run.\n")

    records = list(existing.values())
    new_count = 0

    for path in files:
        source_name = os.path.splitext(os.path.basename(path))[0]
        with open(path, "r", encoding="utf-8") as f:
            raw = f.read()

        chunks = chunk_text(raw)
        pending = [(i, c) for i, c in enumerate(chunks) if f"{source_name}_{i}" not in existing]
        print(f"{source_name}: {len(chunks)} chunks total, {len(pending)} to embed")

        for idx, chunk in pending:
            chunk_id = f"{source_name}_{idx}"
            try:
                vector = embed_with_retry(chunk)
            except Exception as e:
                print(f"  [WARN] embedding permanently failed for {chunk_id}: {e}")
                continue

            records.append({
                "id": chunk_id,
                "source": source_name,
                "text": chunk,
                "embedding": vector,
            })
            new_count += 1

            # Save progress after every chunk so a later interruption loses nothing
            with open(INDEX_PATH, "w", encoding="utf-8") as f:
                json.dump(records, f)

            time.sleep(REQUEST_DELAY)

    print(f"\nDone. {new_count} new chunks embedded this run, {len(records)} total.")
    print(f"Saved -> {os.path.abspath(INDEX_PATH)}")
    print("Now copy/deploy the 'rag' folder (including index/knowledge_index.json) "
          "with your gemini-backend service.")


if __name__ == "__main__":
    main()
