import express from "express";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import "./keepAlive.js";
import { loadKnowledgeBase, retrieveContext } from "./rag/retriever.js";

dotenv.config();

const app = express();

// render proxy
app.set("trust proxy", 1);

// Load the scraped + embedded knowledge base into memory once at startup.
// If rag/index/knowledge_index.json doesn't exist yet, the chatbot still
// works — it just answers without retrieval until you run the RAG scripts
// (see rag/scripts/README.md).
loadKnowledgeBase();

//  Rate Limiter
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100, // 100 requests per minute
  message: { error: "Too many requests. Please wait." },
});

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/chat", limiter);

app.get("/", (req, res) => {
  res.send("Gemini + RAG backend is running 🚀");
});

// Simple in-memory cache (keyed by raw message — RAG answers depend on the
// question only, so this is still safe to reuse from the old version)
const cache = new Map();

const GENERATION_MODEL = "gemini-3.5-flash";

const SYSTEM_PREAMBLE = `You are ElectraGuard's assistant. ElectraGuard is an electricity theft
detection and consumer-support app for Pakistan. Answer the user's question in a clear,
friendly, and concise way.

If context from Pakistani electricity utility sources (DISCOs, NEPRA, WAPDA, K-Electric) is
provided below, base your answer on it and mention which utility/source the info is from when
relevant. If no context is provided, or the context doesn't cover the question, answer using
your general knowledge but make clear you're not quoting an official source, and suggest the
user verify with their local DISCO or NEPRA for anything bill/tariff specific.`;

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message required" });
    }

    if (message.length > 2000) {
      return res.status(400).json({ error: "Message too long." });
    }

    // Cache check — same message dobara Gemini ko nahi jayegi
    if (cache.has(message)) {
      return res.json(cache.get(message));
    }

    // 1. Retrieve relevant chunks from the scraped DISCO/NEPRA/WAPDA/K-Electric knowledge base
    const { chunks, sources } = await retrieveContext(message, process.env.GEMINI_API_KEY, 4);

    const contextBlock =
      chunks.length > 0
        ? `\n\nRELEVANT CONTEXT:\n${chunks.map((c, i) => `[${i + 1}] ${c}`).join("\n\n")}`
        : "\n\n(No matching context was found in the knowledge base for this question.)";

    const fullPrompt = `${SYSTEM_PREAMBLE}${contextBlock}\n\nUSER QUESTION: ${message}`;

    // 2. Generate the answer with Gemini, grounded in the retrieved context
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${GENERATION_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: fullPrompt }] }],
      },
      { timeout: 30000 }
    );

    const reply = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    const finalReply = reply || "No response received.";

    const payload = { reply: finalReply, sources };

    // Cache mein save karo
    cache.set(message, payload);

    // Cache size limit — 100 se zyada entries delete karo
    if (cache.size > 100) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }

    res.json(payload);
  } catch (error) {
    const status = error.response?.status;
    const errData = error.response?.data || error.message;
    console.error(errData);

    // 429 = Quota exceeded
    if (status === 429) {
      return res.status(429).json({ error: "Gemini quota exceeded. Please try again later." });
    }

    res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
