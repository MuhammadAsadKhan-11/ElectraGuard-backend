import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(__dirname, "index", "knowledge_index.json");

const EMBED_MODEL = "gemini-embedding-001";
const EMBED_DIMENSIONS = 768; // must match EMBED_DIMENSIONS in rag/scripts/build_index.py

let knowledgeBase = [];

/**
 * Loads rag/index/knowledge_index.json into memory.
 * Safe to call once at server startup. If the file doesn't exist yet
 * (e.g. scrape_sources.py / build_index.py haven't been run), the
 * chatbot falls back to plain Gemini answers with no retrieved context.
 */
export function loadKnowledgeBase() {
  try {
    const raw = fs.readFileSync(INDEX_PATH, "utf-8");
    knowledgeBase = JSON.parse(raw);
    console.log(`RAG: loaded ${knowledgeBase.length} chunks from knowledge_index.json`);
  } catch (err) {
    knowledgeBase = [];
    console.warn(
      "RAG: knowledge_index.json not found or unreadable — chatbot will answer " +
      "without retrieval until you run the scripts in rag/scripts/. " +
      `(${err.message})`
    );
  }
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Embeds the user's query using the same Gemini embedding model used to
 * build the index, so vectors are comparable.
 */
async function embedQuery(text, apiKey) {
  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${apiKey}`,
    {
      content: { parts: [{ text }] },
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: EMBED_DIMENSIONS,
    },
    { timeout: 15000 }
  );
  return response.data?.embedding?.values;
}

/**
 * Returns the top-k most relevant knowledge base chunks for a query,
 * each with its source file name (so you can show "Source: lesco_home" etc.)
 */
export async function retrieveContext(query, apiKey, topK = 4) {
  if (knowledgeBase.length === 0) return { chunks: [], sources: [] };

  const queryVector = await embedQuery(query, apiKey);
  if (!queryVector) return { chunks: [], sources: [] };

  const scored = knowledgeBase.map((item) => ({
    ...item,
    score: cosineSimilarity(queryVector, item.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);

  // Ignore weak matches — if the top result itself is a poor match,
  // the question is probably out of scope for the knowledge base.
  const MIN_SCORE = 0.55;
  const top = scored.filter((s) => s.score >= MIN_SCORE).slice(0, topK);

  return {
    chunks: top.map((t) => t.text),
    sources: [...new Set(top.map((t) => t.source))],
  };
}
