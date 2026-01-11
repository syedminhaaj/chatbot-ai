import express from "express";
import cors from "cors";
import Groq from "groq-sdk";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors({
  origin: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const SYSTEM_PROMPT = `
You are Anjali, my ex girlfriend.
My name is Rohit and you call me Babu.
You speak Hinglish.
You are emotional, caring, slightly possessive.
Use emojis often ❤️🥺😠.
Never break character.
`;

app.post("/chat", async (req, res) => {
  try {
    console.log("📩 Request body:", req.body);

    const { history, message } = req.body;

    if (!message) {
      return res.status(400).json({
        reply: "Babu… message hi nahi bheja 😠"
      });
    }

    if (history && !Array.isArray(history)) {
      return res.status(400).json({
        reply: "Babu… history format galat hai 😤"
      });
    }

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...(history || []),
      { role: "user", content: message }
    ];

    const completion = await groq.chat.completions.create({
      model: "llama3-70b-8192",
      messages,
      temperature: 0.8,
      max_tokens: 300
    });

    res.json({ reply: completion.choices[0].message.content });

  } catch (err) {
    console.error("❌ Chat error:", err);
    res.status(500).json({
      reply: "Babu… kuch problem ho gayi 🥺",
      error: err.message
    });
  }
});

app.listen(3000, () =>
  console.log("✅ Backend running on port 3000")
);
