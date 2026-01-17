import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

// Initialize Google Calendar API
const calendar = google.calendar({
  version: "v3",
  auth: new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  }),
});

/**
 * Get available time slots for an instructor on a specific date
 * @param {string} instructorEmail - Instructor's calendar email
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {Array} Array of available slots {start, end}
 */
export async function getAvailableSlots(instructorEmail, date) {
  try {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // Fetch existing events for the day
    const response = await calendar.events.list({
      calendarId: instructorEmail,
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    const bookedSlots = response.data.items || [];

    // Define working hours (e.g., 9 AM to 6 PM)
    const workingHours = {
      start: 9,
      end: 18,
    };

    // Generate all possible 1-hour slots
    const allSlots = [];
    for (let hour = workingHours.start; hour < workingHours.end; hour++) {
      const slotStart = new Date(date);
      slotStart.setHours(hour, 0, 0, 0);

      const slotEnd = new Date(date);
      slotEnd.setHours(hour + 1, 0, 0, 0);

      allSlots.push({
        start: formatTime(slotStart),
        end: formatTime(slotEnd),
        startDate: slotStart,
        endDate: slotEnd,
      });
    }

    // Filter out booked slots
    const availableSlots = allSlots.filter((slot) => {
      return !bookedSlots.some((booked) => {
        const bookedStart = new Date(booked.start.dateTime);
        const bookedEnd = new Date(booked.end.dateTime);

        // Check if slot overlaps with booked event
        return (
          (slot.startDate >= bookedStart && slot.startDate < bookedEnd) ||
          (slot.endDate > bookedStart && slot.endDate <= bookedEnd) ||
          (slot.startDate <= bookedStart && slot.endDate >= bookedEnd)
        );
      });
    });

    return availableSlots.map((slot) => ({
      start: slot.start,
      end: slot.end,
    }));
  } catch (error) {
    console.error("Error fetching available slots:", error);
    return [];
  }
}

/**
 * Check if a specific time is available
 * @param {string} instructorEmail - Instructor's calendar email
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {string} time - Time in HH:MM format
 * @returns {boolean} True if available
 */
export async function checkTimeAvailable(instructorEmail, date, time) {
  try {
    const [hours, minutes] = time.split(":").map(Number);

    const startTime = new Date(date);
    startTime.setHours(hours, minutes, 0, 0);

    const endTime = new Date(startTime);
    endTime.setHours(hours + 1, minutes, 0, 0);

    const response = await calendar.events.list({
      calendarId: instructorEmail,
      timeMin: startTime.toISOString(),
      timeMax: endTime.toISOString(),
      singleEvents: true,
    });

    // If no events found, time is available
    return (response.data.items || []).length === 0;
  } catch (error) {
    console.error("Error checking time availability:", error);
    return false;
  }
}

/**
 * Create a pending lesson (calendar event)
 * @param {Object} lessonData - Lesson details
 */
export async function createPendingLesson({
  instructorEmail,
  date,
  startTime,
  endTime,
  studentName,
  studentPhone,
}) {
  try {
    const [startHours, startMinutes] = startTime.split(":").map(Number);
    const [endHours, endMinutes] = endTime.split(":").map(Number);

    const startDateTime = new Date(date);
    startDateTime.setHours(startHours, startMinutes, 0, 0);

    const endDateTime = new Date(date);
    endDateTime.setHours(endHours, endMinutes, 0, 0);

    const event = {
      summary: `Driving Lesson - ${studentName}`,
      description: `Student: ${studentName}\nPhone: ${studentPhone}\nStatus: Pending Approval`,
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: "America/Toronto",
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: "America/Toronto",
      },
      colorId: "5", // Yellow for pending
      attendees: [
        {
          email: instructorEmail,
          responseStatus: "needsAction",
        },
      ],
    };

    const response = await calendar.events.insert({
      calendarId: instructorEmail,
      resource: event,
      sendUpdates: "all", // Send email notification
    });

    console.log("✅ Lesson created:", response.data.htmlLink);
    return response.data;
  } catch (error) {
    console.error("❌ Error creating lesson:", error);
    throw error;
  }
}

/**
 * Format time to HH:MM
 */
function formatTime(date) {
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Get instructor's busy times for a date range (for calendar view)
 */
export async function getInstructorBusyTimes(instructorEmail, startDate, endDate) {
  try {
    const response = await calendar.events.list({
      calendarId: instructorEmail,
      timeMin: new Date(startDate).toISOString(),
      timeMax: new Date(endDate).toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    return (response.data.items || []).map((event) => ({
      start: event.start.dateTime,
      end: event.end.dateTime,
      summary: event.summary,
    }));
  } catch (error) {
    console.error("Error fetching busy times:", error);
    return [];
  }
}