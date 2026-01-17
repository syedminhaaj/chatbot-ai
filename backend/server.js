import express from "express";
import cors from "cors";
import Groq from "groq-sdk";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { createPendingLesson } from "./googleCalendar.js";
import { extractBookingDetails } from "./ai/bookingExtractor.js";

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
    const text = message.toLowerCase();
    const booking = await extractBookingDetails(message);

    // 🔹 HANDLE BOOKING INTENT FIRST
    if (booking.intent === "booking") {
      if (!booking.instructor) {
        return res.json({ reply: "Which instructor would you like?" });
      }

      if (!booking.date) {
        return res.json({ reply: "Please tell me the preferred date." });
      }

      if (!booking.time) {
        return res.json({ reply: "Please tell me the preferred time." });
      }

      return res.json({
        reply:
          `I found this booking:\n` +
          `Instructor: ${booking.instructor}\n` +
          `Date: ${booking.date}\n` +
          `Time: ${booking.time}\n\n` +
          `Please confirm (Yes/No).`,
      });
    }
    if (!text) {
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

    if (
      text.includes("book") ||
      text.includes("booking") ||
      text.includes("schedule") ||
      text.includes("appointment")
    ) {
      return res.json({
        reply:
          "Sure 😊 What would you like to do?\n\n" +
          "1️⃣ See available instructors\n" +
          "2️⃣ Check available time slots\n" +
          "3️⃣ Book a lesson\n\n" +
          "Please reply with 1, 2, or 3.",
      });
    }

    // 🔹 INSTRUCTOR LIST
    if (
      text === "1" ||
      text.includes("instructor") ||
      text.includes("teachers")
    ) {
      const instructors = await getInstructors();
      const active = instructors.filter((i) => i.active);

      if (active.length === 0) {
        return res.json({
          reply: "No instructors are available at the moment.",
        });
      }

      const names = active.map((i) => `• ${i.name}`).join("\n");

      return res.json({
        reply: `Our available instructors are:\n${names}`,
      });
    }

    // 🔹 BOOKING OPTION SELECTED
    if (text === "3") {
      return res.json({
        reply:
          "Great 👍 Please tell me:\n" +
          "• Instructor name\n" +
          "• Preferred date (YYYY-MM-DD)\n" +
          "• Preferred time\n\n" +
          "Example:\nJohn on 2026-01-20 at 11:00 AM",
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
        content: text,
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

import { getInstructors } from "./googleSheets.js";

app.get("/test-instructors", async (req, res) => {
  const data = await getInstructors();
  res.json(data);
});

app.post("/book-lesson", async (req, res) => {
  try {
    const {
      instructorEmail,
      date,
      startTime,
      endTime,
      studentName,
      studentPhone,
    } = req.body;

    await createPendingLesson({
      instructorEmail,
      date,
      startTime,
      endTime,
      studentName,
      studentPhone,
    });

    res.json({
      success: true,
      message:
        "Your booking request has been sent to the instructor for approval.",
    });
  } catch (err) {
    console.error("Booking error:", err);
    res.status(500).json({
      success: false,
      message: "Could not create booking.",
    });
  }
});

app.listen(3000, () => console.log("✅ Backend running on port 3000"));
