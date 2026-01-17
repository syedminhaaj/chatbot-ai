import express from "express";
import cors from "cors";
import Groq from "groq-sdk";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { createPendingLesson } from "./googleCalendar.js";
import { extractBookingDetails } from "./ai/bookingExtractor.js";
import { getInstructors } from "./googleSheets.js";

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

// Session storage for multi-step booking
const bookingSessions = new Map();

app.post("/chat", async (req, res) => {
  try {
    const { message, sessionId = "default" } = req.body;
    const text = message.toLowerCase();
    
    // Get or create session
    let session = bookingSessions.get(sessionId) || {
      state: "idle",
      data: {}
    };

    console.log("📨 Message:", message);
    console.log("🔄 Session state:", session.state);

    // PRIORITY 1: If already in booking flow, continue it
    if (session.state !== "idle") {
      console.log("✅ Continuing booking flow...");
      return await handleBookingFlow(req, res, null, session, sessionId, message);
    }

    // PRIORITY 2: Check for booking keywords
    const bookingKeywords = [
      "book", "booking", "schedule", "appointment", "reserve", 
      "lesson", "slot", "available", "instructor", "time"
    ];
    
    const hasBookingIntent = bookingKeywords.some(keyword => text.includes(keyword));

    if (hasBookingIntent) {
      console.log("✅ Booking intent detected!");
      // Extract details but don't rely on AI for intent
      const booking = { intent: "booking" };
      return await handleBookingFlow(req, res, booking, session, sessionId, message);
    }

    // PRIORITY 3: Regular chat flow
    if (!text) {
      return res.json({
        reply: "Please ask a driving-related question.",
      });
    }

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
        content: text,
      },
    ];

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages,
      temperature: 0.2,
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

async function handleBookingFlow(req, res, booking, session, sessionId, message) {
  const text = message.toLowerCase();

  // ESCAPE HATCH: If user asks a question, switch to general chat
  const questionKeywords = [
    'which instructor', 'which course', 'what course', 'tell me about',
    'what is', 'how much', 'price', 'cost', 'available instructor',
    'who are', 'list of', 'show instructor'
  ];
  
  const isQuestion = questionKeywords.some(kw => text.includes(kw));
  
  if (isQuestion && !text.includes('slot') && !text.includes('time')) {
    console.log("🔄 Switching to general chat for question");
    
    // Keep session but answer the question
    const websiteContent = loadDrivingSchoolData();
    
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

    try {
      const completion = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages,
        temperature: 0.2,
        max_tokens: 300,
      });

      const answer = completion.choices[0].message.content;
      
      return res.json({
        reply: `${answer}\n\n---\n\nWe were booking a lesson. Would you like to continue? Type 'continue' or start over with 'book'.`
      });
    } catch (err) {
      console.error("Error answering question:", err);
    }
  }
  
  // Handle "continue" to resume booking
  if ((text.includes('continue') || text.includes('yes') || text.includes('proceed')) && session.state !== "awaiting_confirmation") {
    const stateMessages = {
      "awaiting_action": "Great! Would you like to:\n1️⃣ See all available slots\n2️⃣ Choose a specific instructor",
      "awaiting_instructor": "Which instructor would you like? (Tell me the number or name)",
      "awaiting_date": "When would you like to book? (e.g., tomorrow, Jan 25, next Monday)",
      "awaiting_date_for_all_slots": "When would you like to see available slots?",
      "awaiting_time_check": "Would you like to:\n1️⃣ See all available slots\n2️⃣ Request a specific time",
      "awaiting_slot_selection": "Which slot would you like? (Tell me the number)",
      "awaiting_slot_selection_from_all": "Which slot number would you like?",
      "awaiting_specific_time": "What time would you prefer?",
      "awaiting_student_info": "Please provide your name and phone number"
    };
    
    return res.json({
      reply: stateMessages[session.state] || "Let's continue booking. Where were we?"
    });
  }
  
  // Handle "start over", "reset", "cancel"
  if (text.includes('start over') || text.includes('reset') || text.includes('cancel booking') || text.includes('restart')) {
    bookingSessions.delete(sessionId);
    return res.json({
      reply: "No problem! Booking cancelled.\n\nType 'book a lesson' when you're ready to start again, or ask me anything about our driving school! 😊"
    });
  }

  // STATE: IDLE -> Ask what they want to do
  if (session.state === "idle") {
    session.state = "awaiting_action";
    session.data = {};
    bookingSessions.set(sessionId, session);

    return res.json({
      reply: `Great! Let's help you with booking 🚗\n\nWhat would you like to do?\n\n1️⃣ See all available slots across all instructors\n2️⃣ Choose a specific instructor first\n\nReply with 1 or 2.`,
    });
  }

  // STATE: AWAITING_ACTION
  if (session.state === "awaiting_action") {
    if (text.includes("1") || text.includes("all") || text.includes("available")) {
      session.state = "awaiting_date_for_all_slots";
      bookingSessions.set(sessionId, session);

      return res.json({
        reply: `Perfect! When would you like to book?\n\nYou can say:\n• "tomorrow"\n• "Jan 27" or "January 27"\n• "after 10 days"\n• "next Monday"\n• Any date you prefer`,
      });
    } else if (text.includes("2") || text.includes("instructor") || text.includes("specific")) {
      session.state = "awaiting_instructor";
      bookingSessions.set(sessionId, session);

      const instructors = await getInstructors();
      const active = instructors.filter((i) => i.active);

      if (active.length === 0) {
        return res.json({
          reply: "No instructors are available at the moment.",
        });
      }

      const names = active.map((i, idx) => `${idx + 1}. ${i.name}`).join("\n");

      return res.json({
        reply: `Please select an instructor:\n${names}\n\nYou can reply with the number or name.`,
      });
    } else {
      return res.json({
        reply: "Please reply with 1 (see all slots) or 2 (choose instructor first).",
      });
    }
  }

  // STATE: AWAITING_DATE_FOR_ALL_SLOTS
  if (session.state === "awaiting_date_for_all_slots") {
    try {
      const dateInfo = await parseNaturalDate(message);
      
      if (!dateInfo.date) {
        return res.json({
          reply: "I couldn't understand that date. Could you try again?\n\nExamples:\n• tomorrow\n• Jan 27\n• next Friday\n• 2026-01-27",
        });
      }

      session.data.date = dateInfo.date;
      session.data.dateFormatted = dateInfo.formatted;
      bookingSessions.set(sessionId, session);

      // Get all instructors and their availability
      const instructors = await getInstructors();
      const active = instructors.filter((i) => i.active);

      let allSlotsText = `📅 Available slots on ${dateInfo.formatted}:\n\n`;
      let hasSlots = false;
      let allSlots = [];

      for (const instructor of active) {
        const slots = await getAvailableSlots(instructor.email, dateInfo.date);
        
        if (slots.length > 0) {
          hasSlots = true;
          allSlotsText += `👨‍🏫 ${instructor.name}:\n`;
          
          slots.forEach((slot, idx) => {
            const slotNumber = allSlots.length + 1;
            allSlots.push({
              instructor: instructor,
              slot: slot,
              number: slotNumber
            });
            allSlotsText += `   ${slotNumber}. ${slot.start} - ${slot.end}\n`;
          });
          
          allSlotsText += '\n';
        }
      }

      if (!hasSlots) {
        session.state = "awaiting_date_for_all_slots";
        bookingSessions.set(sessionId, session);
        
        return res.json({
          reply: `Sorry, no slots available on ${dateInfo.formatted}.\n\nWould you like to try a different date?`,
        });
      }

      session.data.allAvailableSlots = allSlots;
      session.state = "awaiting_slot_selection_from_all";
      bookingSessions.set(sessionId, session);

      allSlotsText += `\nPlease select a slot number (1-${allSlots.length}).`;

      return res.json({
        reply: allSlotsText,
      });
    } catch (error) {
      console.error("❌ Error parsing date for all slots:", error);
      return res.json({
        reply: "I had trouble understanding that. Could you please provide the date in a format like:\n• tomorrow\n• Jan 27\n• next Monday",
      });
    }
  }

  // STATE: AWAITING_SLOT_SELECTION_FROM_ALL
  if (session.state === "awaiting_slot_selection_from_all") {
    const num = parseInt(text);
    
    if (isNaN(num) || num < 1 || num > session.data.allAvailableSlots.length) {
      return res.json({
        reply: `Please select a valid slot number (1-${session.data.allAvailableSlots.length}).`,
      });
    }

    const selected = session.data.allAvailableSlots[num - 1];
    session.data.instructor = selected.instructor;
    session.data.startTime = selected.slot.start;
    session.data.endTime = selected.slot.end;
    session.state = "awaiting_student_info";
    bookingSessions.set(sessionId, session);

    return res.json({
      reply: `Perfect! You selected:\n👨‍🏫 ${selected.instructor.name}\n📅 ${session.data.dateFormatted}\n⏰ ${selected.slot.start} - ${selected.slot.end}\n\nPlease provide your name and phone number.\nExample: "John Doe, 416-555-1234"`,
    });
  }

  // STATE: AWAITING_INSTRUCTOR
  if (session.state === "awaiting_instructor") {
    const instructors = await getInstructors();
    const active = instructors.filter((i) => i.active);

    let selectedInstructor = null;

    // Check if number
    const num = parseInt(text);
    if (!isNaN(num) && num > 0 && num <= active.length) {
      selectedInstructor = active[num - 1];
    } else {
      // Check by name with fuzzy matching
      selectedInstructor = active.find(i => 
        i.name.toLowerCase().includes(text) || 
        text.includes(i.name.toLowerCase()) ||
        // Handle first name only
        i.name.toLowerCase().split(' ')[0] === text
      );
    }

    if (!selectedInstructor) {
      return res.json({
        reply: "I couldn't find that instructor. Please try again:\n• Type the number (1, 2, etc.)\n• Or type their name",
      });
    }

    session.data.instructor = selectedInstructor;
    session.state = "awaiting_date";
    bookingSessions.set(sessionId, session);

    return res.json({
      reply: `Perfect! You selected ${selectedInstructor.name}.\n\nWhen would you like to book?\n\nYou can say:\n• "tomorrow"\n• "Jan 27" or "January 27"\n• "after 10 days"\n• "next Monday"\n• Any date you prefer`,
    });
  }

  // STATE: AWAITING_DATE
  if (session.state === "awaiting_date") {
    try {
      const dateInfo = await parseNaturalDate(message);
      
      if (!dateInfo.date) {
        return res.json({
          reply: "I couldn't understand that date. Could you try again?\n\nExamples:\n• tomorrow\n• Jan 27\n• next Friday\n• 2026-01-27",
        });
      }

      session.data.date = dateInfo.date;
      session.data.dateFormatted = dateInfo.formatted;
      session.state = "awaiting_time_check";
      bookingSessions.set(sessionId, session);

      return res.json({
        reply: `Got it! ${dateInfo.formatted}\n\nWould you like to:\n1️⃣ See all available slots for that day\n2️⃣ Request a specific time\n\nReply with 1 or 2.`,
      });
    } catch (error) {
      console.error("❌ Error parsing date:", error);
      return res.json({
        reply: "I had trouble understanding that date. Could you please try again?\n\nExamples:\n• tomorrow\n• Jan 27\n• next Monday",
      });
    }
  }

  // STATE: AWAITING_TIME_CHECK
  if (session.state === "awaiting_time_check") {
    // First check if user mentioned a time directly
    const timeInfo = await parseTime(message);
    
    if (timeInfo.time) {
      // User specified a time directly - check availability
      const isAvailable = await checkTimeAvailable(
        session.data.instructor.email,
        session.data.date,
        timeInfo.time
      );

      if (!isAvailable) {
        return res.json({
          reply: `Sorry, ${timeInfo.formatted || timeInfo.time} is not available.\n\nWould you like to:\n1️⃣ See all available slots\n2️⃣ Try a different time\n\nJust let me know!`,
        });
      }

      session.data.startTime = timeInfo.time;
      session.data.endTime = timeInfo.endTime;
      session.state = "awaiting_student_info";
      bookingSessions.set(sessionId, session);

      return res.json({
        reply: `Perfect! ${timeInfo.formatted || timeInfo.time} is available.\n\nPlease provide your name and phone number.\nExample: "John Doe, 416-555-1234"`,
      });
    }

    // Check if they want to see all slots
    const intent = await understandIntent(message, [
      "see all available slots",
      "request specific time",
    ]);

    if (intent.includes("all") || intent.includes("see") || text.includes("1")) {
      const slots = await getAvailableSlots(
        session.data.instructor.email,
        session.data.date
      );

      if (slots.length === 0) {
        session.state = "awaiting_date";
        bookingSessions.set(sessionId, session);
        return res.json({
          reply: `No available slots on ${session.data.dateFormatted} for ${session.data.instructor.name}.\n\nWould you like to try another date?`,
        });
      }

      const slotList = slots.map((s, i) => `${i + 1}. ${s.start} - ${s.end}`).join("\n");
      session.data.availableSlots = slots;
      session.state = "awaiting_slot_selection";
      bookingSessions.set(sessionId, session);

      return res.json({
        reply: `Available slots on ${session.data.dateFormatted} for ${session.data.instructor.name}:\n\n${slotList}\n\nWhich slot would you like? (tell me the number or time)`,
      });
    } else {
      session.state = "awaiting_specific_time";
      bookingSessions.set(sessionId, session);

      return res.json({
        reply: "What time would you prefer?\n\nExamples:\n• 10:00 AM\n• 2:30 PM\n• 14:00\n• morning\n• afternoon",
      });
    }
  }

  // STATE: AWAITING_SLOT_SELECTION
  if (session.state === "awaiting_slot_selection") {
    const num = await extractNumber(message, 1, session.data.availableSlots.length);
    
    if (!num) {
      // Maybe they typed a time instead?
      const timeInfo = await parseTime(message);
      if (timeInfo.time) {
        // Find slot matching this time
        const matchingSlot = session.data.availableSlots.find(s => s.start === timeInfo.time);
        if (matchingSlot) {
          session.data.startTime = matchingSlot.start;
          session.data.endTime = matchingSlot.end;
          session.state = "awaiting_student_info";
          bookingSessions.set(sessionId, session);

          return res.json({
            reply: `Great! ${matchingSlot.start} - ${matchingSlot.end} it is!\n\nPlease provide your name and phone number.\nExample: "John Doe, 416-555-1234"`,
          });
        }
      }
      
      return res.json({
        reply: `Please tell me which slot (1-${session.data.availableSlots.length}).\n\nYou can say:\n• "slot 3"\n• "number 3"\n• "3"\n• Or tell me the time you want`,
      });
    }

    const selectedSlot = session.data.availableSlots[num - 1];
    session.data.startTime = selectedSlot.start;
    session.data.endTime = selectedSlot.end;
    session.state = "awaiting_student_info";
    bookingSessions.set(sessionId, session);

    return res.json({
      reply: `Great! ${selectedSlot.start} - ${selectedSlot.end} it is!\n\nPlease provide your name and phone number.\nExample: "John Doe, 416-555-1234"`,
    });
  }

  // STATE: AWAITING_SPECIFIC_TIME
  if (session.state === "awaiting_specific_time") {
    try {
      const timeInfo = await parseTime(message);
      
      if (!timeInfo.time) {
        // Try harder with AI
        const fallbackTime = await extractTimeFallback(message);
        if (fallbackTime.time) {
          session.data.startTime = fallbackTime.time;
          session.data.endTime = fallbackTime.endTime;
        } else {
          return res.json({
            reply: `I'm having trouble with that time. Let me help:\n\n✅ Try: "10 AM", "2:30 PM", "afternoon"\n❌ I got: "${message}"\n\nWhat time works for you?`,
          });
        }
      } else {
        session.data.startTime = timeInfo.time;
        session.data.endTime = timeInfo.endTime;
      }

      // Check if time is available
      const isAvailable = await checkTimeAvailable(
        session.data.instructor.email,
        session.data.date,
        session.data.startTime
      );

      if (!isAvailable) {
        return res.json({
          reply: `Sorry, ${timeInfo.formatted || session.data.startTime} is not available.\n\nWould you like to:\n• See all available slots\n• Try a different time\n\nJust let me know!`,
        });
      }

      session.state = "awaiting_student_info";
      bookingSessions.set(sessionId, session);

      return res.json({
        reply: `Perfect! ${timeInfo.formatted || session.data.startTime} is available.\n\nPlease provide your name and phone number.\nExample: "John Doe, 416-555-1234"`,
      });
    } catch (error) {
      console.error("❌ Error parsing time:", error);
      return res.json({
        reply: `Let's try again. What time would you like?\n\nExamples:\n• 10:00 AM\n• 2:30 PM\n• afternoon`,
      });
    }
  }

  // STATE: AWAITING_STUDENT_INFO
  if (session.state === "awaiting_student_info") {
    let studentInfo = extractStudentInfo(message);
    
    // If extraction failed, try with AI
    if (!studentInfo.name || !studentInfo.phone) {
      const aiExtracted = await extractStudentInfoAI(message);
      if (aiExtracted.name) studentInfo.name = aiExtracted.name;
      if (aiExtracted.phone) studentInfo.phone = aiExtracted.phone;
    }
    
    if (!studentInfo.name || !studentInfo.phone) {
      let helpMsg = "Please provide ";
      if (!studentInfo.name && !studentInfo.phone) {
        helpMsg += "both your name and phone number.";
      } else if (!studentInfo.name) {
        helpMsg += "your name.";
      } else {
        helpMsg += "your phone number.";
      }
      
      return res.json({
        reply: `${helpMsg}\n\nExamples:\n• "John Doe, 416-555-1234"\n• "My name is John Doe, call me at 416-555-1234"\n• Just type your name and number in any format!`,
      });
    }

    session.data.studentName = studentInfo.name;
    session.data.studentPhone = studentInfo.phone;
    session.state = "awaiting_confirmation";
    bookingSessions.set(sessionId, session);

    const summary = `
📋 Booking Summary:

👨‍🏫 Instructor: ${session.data.instructor.name}
📅 Date: ${session.data.dateFormatted}
⏰ Time: ${session.data.startTime} - ${session.data.endTime}
🙋 Student: ${session.data.studentName}
📱 Phone: ${session.data.studentPhone}

Is everything correct?

Reply 'yes' to confirm or 'no' to cancel.
    `.trim();

    return res.json({ reply: summary });
  }

  // STATE: AWAITING_CONFIRMATION
  if (session.state === "awaiting_confirmation") {
    // Use AI to understand confirmation
    const intent = await understandIntent(message, [
      "confirm and book",
      "cancel booking",
    ]);

    if (intent.includes("confirm") || text.includes("yes") || text.includes("ok") || text.includes("correct") || text.includes("sure")) {
      try {
        await createPendingLesson({
          instructorEmail: session.data.instructor.email,
          date: session.data.date,
          startTime: session.data.startTime,
          endTime: session.data.endTime,
          studentName: session.data.studentName,
          studentPhone: session.data.studentPhone,
        });

        bookingSessions.delete(sessionId);

        return res.json({
          reply: `✅ Booking request sent successfully!\n\n📋 Your lesson details:\n👨‍🏫 ${session.data.instructor.name}\n📅 ${session.data.dateFormatted}\n⏰ ${session.data.startTime} - ${session.data.endTime}\n\nYour booking is pending instructor approval. You'll receive a confirmation soon! 🚗\n\n---\nNeed anything else? Type 'book' to make another booking or ask me any question about our driving school.`,
        });
      } catch (err) {
        console.error("❌ Booking creation error:", err);
        return res.json({
          reply: "Sorry, there was an error creating your booking. Please try again or contact us directly.\n\nType 'book' to try again.",
        });
      }
    } else {
      bookingSessions.delete(sessionId);
      return res.json({
        reply: "Booking cancelled. No worries!\n\nType 'book a lesson' whenever you're ready to start over. 😊",
      });
    }
  }

  return res.json({ 
    reply: "Something went wrong with the booking process. Let's start over.\n\nType 'book a lesson' to begin." 
  });
}

// Helper: Parse natural language date
// async function parseNaturalDate(message) {
//   const prompt = `
// Convert this to a date in YYYY-MM-DD format.
// Today is ${new Date().toISOString().split('T')[0]}.

// Message: "${message}"

// Return JSON:
// {
//   "date": "YYYY-MM-DD" or null,
//   "formatted": "human readable" or null
// }
// `;

//   const completion = await groq.chat.completions.create({
//     model: "llama-3.1-8b-instant",
//     messages: [{ role: "user", content: prompt }],
//     temperature: 0,
//     max_tokens: 100,
//   });

//   const match = completion.choices[0].message.content.match(/\{[\s\S]*?\}/);
//   if (!match) return { date: null, formatted: null };
  
//   return JSON.parse(match[0]);
// }

async function parseNaturalDate(message) {
  const today = new Date().toISOString().split("T")[0];

  const prompt = `
You MUST return VALID JSON ONLY.
Do NOT use Python syntax.
Do NOT use None.
Use null instead.

Today is ${today}.

Convert the message into a date.

Message: "${message}"

Return EXACTLY this JSON format:
{
  "date": "YYYY-MM-DD" or null,
  "formatted": "January 29, 2026" or null
}
`;

  const completion = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 120,
  });

  const raw = completion.choices[0].message.content.trim();

  // STRICT JSON extraction
  const match = raw.match(/\{[\s\S]*?\}/);
  if (!match) {
    console.error("❌ No JSON found:", raw);
    return { date: null, formatted: null };
  }

  try {
    const parsed = JSON.parse(match[0]);

    // Extra safety validation
    if (
      typeof parsed.date !== "string" &&
      parsed.date !== null
    ) {
      throw new Error("Invalid date type");
    }

    return parsed;
  } catch (err) {
    console.error("❌ Invalid JSON from LLM:", match[0]);
    return { date: null, formatted: null };
  }
}

// Helper: Parse time
async function parseTime(message) {
  const prompt = `
Convert this to 24-hour time format.

Message: "${message}"

Return JSON:
{
  "time": "HH:MM" or null,
  "endTime": "HH:MM" (1 hour later) or null
}
`;

  const completion = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 100,
  });

  const match = completion.choices[0].message.content.match(/\{[\s\S]*?\}/);
  if (!match) return { time: null, endTime: null };
  
  return JSON.parse(match[0]);
}

// Helper: Extract student info
function extractStudentInfo(message) {
  const nameMatch = message.match(/([A-Za-z]+\s+[A-Za-z]+)/);
  const phoneMatch = message.match(/(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/);

  return {
    name: nameMatch ? nameMatch[1] : null,
    phone: phoneMatch ? phoneMatch[1] : null,
  };
}

// Placeholder functions (implement with your Google Sheets/Calendar)
async function getAvailableSlots(instructorEmail, date) {
  console.log("📅 Fetching slots for:", instructorEmail, date);
  
  // For testing without Google Calendar - return mock data
  // TODO: Replace with real Google Calendar integration
  return [
    { start: "09:00", end: "10:00" },
    { start: "11:00", end: "12:00" },
    { start: "14:00", end: "15:00" },
    { start: "16:00", end: "17:00" },
  ];
  
  /* UNCOMMENT when Google Calendar is configured:
  try {
    const { getAvailableSlots: getSlots } = await import("./googleCalendar.js");
    return await getSlots(instructorEmail, date);
  } catch (error) {
    console.error("❌ Calendar error:", error);
    return [];
  }
  */
}

async function checkTimeAvailable(instructorEmail, date, time) {
  console.log("⏰ Checking availability:", instructorEmail, date, time);
  
  // For testing - always return true
  // TODO: Replace with real Google Calendar check
  return true;
  
  /* UNCOMMENT when Google Calendar is configured:
  try {
    const { checkTimeAvailable: checkTime } = await import("./googleCalendar.js");
    return await checkTime(instructorEmail, date, time);
  } catch (error) {
    console.error("❌ Calendar error:", error);
    return false;
  }
  */
}

app.get("/test-instructors", async (req, res) => {
  try {
    console.log("🧪 Testing instructor fetch...");
    const data = await getInstructors();
    console.log("✅ Found instructors:", data);
    res.json({ 
      success: true, 
      count: data.length,
      instructors: data 
    });
  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Add debug endpoint to check session
app.get("/debug-session/:sessionId", (req, res) => {
  const session = bookingSessions.get(req.params.sessionId);
  res.json({
    sessionId: req.params.sessionId,
    session: session || "No session found",
    allSessions: Array.from(bookingSessions.keys())
  });
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

// ============================================================================
// AI HELPER FUNCTIONS - Make system understand ANYTHING
// ============================================================================

async function understandIntent(message, options) {
  const prompt = `
User said: "${message}"

What did they mean? Choose from these options:
${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}

Return ONLY the option text that matches best, nothing else.
`;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 50,
    });

    return completion.choices[0].message.content.toLowerCase();
  } catch (error) {
    console.error("❌ Intent understanding error:", error);
    return "";
  }
}

async function extractNumber(message, min, max) {
  const prompt = `
Extract the number from this message: "${message}"

The number should be between ${min} and ${max}.

Examples:
- "5" → 5
- "slot 5" → 5
- "number 5" → 5
- "the fifth one" → 5
- "I want the 5th" → 5

Return ONLY the number, nothing else. If no valid number, return "null".
`;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 10,
    });

    const num = parseInt(completion.choices[0].message.content);
    
    if (!isNaN(num) && num >= min && num <= max) {
      return num;
    }
    
    return null;
  } catch (error) {
    console.error("❌ Number extraction error:", error);
    return null;
  }
}

async function matchInstructor(message, instructors) {
  const prompt = `
User said: "${message}"

They're trying to select an instructor from this list:
${instructors.map((i, idx) => `${idx + 1}. ${i.name}`).join('\n')}

Which instructor did they mean?

Examples:
- "1" → first instructor
- "john" → John Smith
- "jane doe" → Jane Doe
- "the first one" → first instructor

Return ONLY the exact name from the list, or "null" if unclear.
`;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 30,
    });

    const response = completion.choices[0].message.content.trim();
    
    // Try to match the response to an instructor
    const matched = instructors.find(i => 
      response.toLowerCase().includes(i.name.toLowerCase()) ||
      i.name.toLowerCase().includes(response.toLowerCase())
    );
    
    if (matched) return matched;
    
    // Try number-based selection
    const num = parseInt(response);
    if (!isNaN(num) && num > 0 && num <= instructors.length) {
      return instructors[num - 1];
    }
    
    return null;
  } catch (error) {
    console.error("❌ Instructor matching error:", error);
    return null;
  }
}

async function extractDateFallback(message) {
  const today = new Date();
  const prompt = `
The user said: "${message}"

TODAY is ${today.toISOString().split('T')[0]}.

Try your absolute best to extract a date from this, even if it's unclear.

If you can find ANY hint of a date (day, month, year, relative term), return it.
If there's truly no date information, return null.

Return JSON:
{
  "date": "YYYY-MM-DD" or null,
  "formatted": "Monday, January 27, 2026" or null
}
`;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 100,
    });

    const raw = completion.choices[0].message.content;
    const match = raw.match(/\{[\s\S]*?\}/);

    if (!match) return { date: null, formatted: null };

    return JSON.parse(match[0]);
  } catch (error) {
    console.error("❌ Fallback date extraction error:", error);
    return { date: null, formatted: null };
  }
}

async function extractTimeFallback(message) {
  const prompt = `
The user said: "${message}"

Try your absolute best to extract a time from this.

Examples of what to understand:
- "10" could mean 10:00
- "2" could mean 14:00 (2 PM)
- "morning" → 10:00
- "afternoon" → 14:00
- "evening" → 17:00

Return JSON:
{
  "time": "HH:MM" or null,
  "endTime": "HH:MM" (add 1 hour) or null
}
`;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 100,
    });

    const raw = completion.choices[0].message.content;
    const match = raw.match(/\{[\s\S]*?\}/);

    if (!match) return { time: null, endTime: null };

    return JSON.parse(match[0]);
  } catch (error) {
    console.error("❌ Fallback time extraction error:", error);
    return { time: null, endTime: null };
  }
}

async function extractStudentInfoAI(message) {
  const prompt = `
Extract name and phone number from this message: "${message}"

Examples:
- "john doe 4165551234" → name: "John Doe", phone: "4165551234"
- "im sarah call me 416 555 1234" → name: "Sarah", phone: "416-555-1234"
- "alice johnson" → name: "Alice Johnson", phone: null

Try your best to find a name (first and last) and a 10-digit phone number.

Return JSON:
{
  "name": "Full Name" or null,
  "phone": "phone number" or null
}
`;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 100,
    });

    const raw = completion.choices[0].message.content;
    console.log("🤖 AI Student Info:", raw);
    
    const match = raw.match(/\{[\s\S]*?\}/);

    if (!match) return { name: null, phone: null };

    return JSON.parse(match[0]);
  } catch (error) {
    console.error("❌ AI student info extraction error:", error);
    return { name: null, phone: null };
  }
}