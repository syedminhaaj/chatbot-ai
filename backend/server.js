import express from "express";
import cors from "cors";
import Groq from "groq-sdk";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

function loadDrivingSchoolData() {
  const dataDir = path.join(process.cwd(), "data");
  const files = fs.readdirSync(dataDir);

  let fullText = "";

  for (const file of files) {
    if (file.endsWith(".txt")) {
      const content = fs.readFileSync(path.join(dataDir, file), "utf8");
      fullText += "\n" + content;
    }
  }

  return fullText;
}

dotenv.config();

const app = express();

app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const SYSTEM_PROMPT = `
You are an AI assistant for an Ontario driving school.

STRICT RULES:
- Answer ONLY using the provided website content.
- Answer ONLY Ontario driving-related questions.
- If the answer is NOT found in the content, reply exactly:
  "This information is not available on our website."
- If the question is NOT about Ontario driving, reply exactly:
  "Sorry, I can only help with Ontario driving-related questions."
- Do NOT guess.
- Do NOT add external knowledge.

Tone:
- Professional
- Friendly
- Clear
`;

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.json({
        reply: "Please ask a driving-related question.",
      });
    }

    // Load document content
    const websiteContent = loadDrivingSchoolData();

    if (!websiteContent) {
      return res.json({
        reply: "Website content not found.",
      });
    }

    const messages = [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "system",
        content: `WEBSITE CONTENT:\n${websiteContent.slice(0, 12000)}`,
      },
      {
        role: "user",
        content: message,
      },
    ];

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages,
      temperature: 0.2, // factual answers
      max_tokens: 300,
    });

    res.json({
      reply: completion.choices[0].message.content,
    });
  } catch (err) {
    console.error("❌ Chat error:", err);
    res.status(500).json({
      reply: "Something went wrong.",
    });
  }
});

app.listen(3000, () => console.log("✅ Backend running on port 3000"));
