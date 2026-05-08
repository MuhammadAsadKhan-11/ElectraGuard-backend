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
  max: 30,
  message: { error: "Too many requests. Please wait." }
});

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/chat", limiter);

app.get("/", (req, res) => {
  res.send("Gemini backend is running 🚀");
});

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message required" });
    }

    if (message.length > 2000) {
      return res.status(400).json({ error: "Message too long." });
    }

    //  v1beta ki jagah v1 use karo, aur updated model name
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1/models/gemini-3-flash-preview:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: message }] }],
      },
      { timeout: 30000 }
    );

    const reply = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    res.json({ reply: reply || "No response received." });

  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
