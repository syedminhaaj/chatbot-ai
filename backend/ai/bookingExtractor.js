import Groq from "groq-sdk";
import dotenv from "dotenv";

dotenv.config();

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

/**
 * Extract booking intent and details from user message
 * Understands natural language like "tomorrow", "after 10 days", "next Friday"
 */
export async function extractBookingDetails(message) {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const dayOfWeek = today.toLocaleDateString("en-US", { weekday: "long" });

  const prompt = `
You are a booking assistant. Extract booking information from the user's message.

TODAY'S INFO:
- Date: ${todayStr}
- Day: ${dayOfWeek}

UNDERSTAND THESE PHRASES:
- "tomorrow" = add 1 day to today
- "after 10 days" = add 10 days to today
- "next Monday" = next occurrence of Monday
- "in 2 weeks" = add 14 days
- "this Friday" = upcoming Friday this week
- "January 20" = 2026-01-20 (current year if not specified)

TIME CONVERSION:
- "10 AM" or "10:00 AM" → "10:00"
- "2:30 PM" → "14:30"
- "noon" → "12:00"
- "morning" → suggest slots between 9-12
- "afternoon" → suggest slots between 12-17

Return ONLY valid JSON with these exact keys:
{
  "intent": "booking" or "other",
  "instructor": string or null,
  "date": "YYYY-MM-DD" or null,
  "time": "HH:MM" (24h format) or null,
  "timePreference": "morning" | "afternoon" | "evening" | null
}

RULES:
- Set intent to "booking" if message mentions: book, schedule, appointment, lesson, reserve
- Extract instructor name if mentioned
- Convert natural dates to YYYY-MM-DD
- Convert times to 24-hour format
- If time is vague (morning/afternoon), set timePreference instead of time
- Do NOT guess missing information
- Return null for fields not found in the message

USER MESSAGE:
"${message}"

Return JSON only, no explanation:
`;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 200,
    });

    const raw = completion.choices[0].message.content;

    // Extract JSON from response
    const match = raw.match(/\{[\s\S]*?\}/);

    if (!match) {
      return {
        intent: "other",
        instructor: null,
        date: null,
        time: null,
        timePreference: null,
      };
    }

    const result = JSON.parse(match[0]);

    // Validate the result
    return {
      intent: result.intent || "other",
      instructor: result.instructor || null,
      date: result.date || null,
      time: result.time || null,
      timePreference: result.timePreference || null,
    };
  } catch (error) {
    console.error("Error extracting booking details:", error);
    return {
      intent: "other",
      instructor: null,
      date: null,
      time: null,
      timePreference: null,
    };
  }
}

/**
 * Parse natural language date into YYYY-MM-DD format
 */
export async function parseNaturalDate(message) {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  const prompt = `
Convert the date expression to YYYY-MM-DD format.

TODAY: ${todayStr}

Examples:
- "tomorrow" → ${addDays(today, 1).toISOString().split("T")[0]}
- "after 10 days" → ${addDays(today, 10).toISOString().split("T")[0]}
- "next Monday" → [calculate next Monday]
- "January 20" → "2026-01-20"

USER INPUT: "${message}"

Return JSON:
{
  "date": "YYYY-MM-DD" or null,
  "formatted": "Monday, January 20, 2026" or null
}

Return JSON only:
`;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 100,
    });

    const raw = completion.choices[0].message.content;
    const match = raw.match(/\{[\s\S]*?\}/);

    if (!match) {
      return { date: null, formatted: null };
    }

    return JSON.parse(match[0]);
  } catch (error) {
    console.error("Error parsing date:", error);
    return { date: null, formatted: null };
  }
}

/**
 * Parse time and calculate end time (default 1-hour lesson)
 */
export async function parseTime(message, lessonDuration = 60) {
  const prompt = `
Convert time to 24-hour format and calculate end time.

Examples:
- "10 AM" → start: "10:00", end: "11:00"
- "2:30 PM" → start: "14:30", end: "15:30"
- "noon" → start: "12:00", end: "13:00"

USER INPUT: "${message}"
LESSON DURATION: ${lessonDuration} minutes

Return JSON:
{
  "time": "HH:MM" or null,
  "endTime": "HH:MM" or null,
  "formatted": "10:00 AM" or null
}

Return JSON only:
`;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 100,
    });

    const raw = completion.choices[0].message.content;
    const match = raw.match(/\{[\s\S]*?\}/);

    if (!match) {
      return { time: null, endTime: null, formatted: null };
    }

    return JSON.parse(match[0]);
  } catch (error) {
    console.error("Error parsing time:", error);
    return { time: null, endTime: null, formatted: null };
  }
}

/**
 * Helper: Add days to a date
 */
function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Extract student information (name and phone)
 */
export function extractStudentInfo(message) {
  // Match patterns like "John Doe, 416-555-1234" or "John Doe 416-555-1234"
  const patterns = [
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)[,\s]+(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/i,
    /([A-Z][a-z]+\s+[A-Z][a-z]+)/i,
  ];

  let name = null;
  let phone = null;

  // Try to match name and phone together
  const match1 = message.match(patterns[0]);
  if (match1) {
    name = match1[1].trim();
    phone = match1[2].trim();
  } else {
    // Try to match name only
    const match2 = message.match(patterns[1]);
    if (match2) {
      name = match2[1].trim();
    }

    // Try to match phone only
    const phoneMatch = message.match(/(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/);
    if (phoneMatch) {
      phone = phoneMatch[1].trim();
    }
  }

  return { name, phone };
}