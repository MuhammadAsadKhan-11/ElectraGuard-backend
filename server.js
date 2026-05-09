import express from "express";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import './keepAlive.js';

dotenv.config();

const app = express();

//render proxy 
app.set('trust proxy', 1);

//  Rate Limiter
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15, // Gemini free tier = 15 RPM, isliye 15 rakho
  message: { error: "Too many requests. Please wait." }
});

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/chat", limiter);

app.get("/", (req, res) => {
  res.send("Gemini backend is running 🚀");
});

// Simple in-memory cache
const cache = new Map();

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
      return res.json({ reply: cache.get(message) });
    }

    // ✅ Model: gemini-3.0-flash-preview → gemini-1.5-flash
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: message }] }],
      },
      { timeout: 30000 }
    );

    const reply = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    const finalReply = reply || "No response received.";

    // Cache mein save karo
    cache.set(message, finalReply);

    // Cache size limit — 100 se zyada entries delete karo
    if (cache.size > 100) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }

    res.json({ reply: finalReply });

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