import Groq from "groq-sdk";
import dotenv from "dotenv";

dotenv.config();

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export async function extractBookingDetails(message) {
  const prompt = `
Extract booking information from the message.

Return ONLY valid JSON with these keys:
- intent: "booking" or "other"
- instructor: string or null
- date: YYYY-MM-DD or null
- time: HH:MM (24h) or null

Rules:
- Understand phrases like "tomorrow", "after 10 days", "next Friday"
- Convert AM/PM to 24-hour time
- Do NOT guess missing fields
- If not a booking request, intent = "other"

Message:
"${message}"
`;

  const completion = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 200,
  });

  const raw = completion.choices[0].message.content;

  // ✅ Extract ONLY the first JSON object
  const match = raw.match(/\{[\s\S]*?\}/);

  if (!match) {
    throw new Error("No JSON object found in AI response");
  }

  return JSON.parse(match[0]);
}
