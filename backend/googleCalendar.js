import { google } from "googleapis";
import fs from "fs";

const auth = new google.auth.GoogleAuth({
  keyFile: "google-service-account.json",
  scopes: ["https://www.googleapis.com/auth/calendar"],
});

export async function createPendingLesson({
  instructorEmail,
  date,
  startTime,
  endTime,
  studentName,
  studentPhone,
}) {
  const startDateTime = `${date}T${startTime}:00`;
  const endDateTime = `${date}T${endTime}:00`;

  const event = {
    summary: "Driving Lesson (Pending Approval)",
    description: `
Student: ${studentName}
Phone: ${studentPhone}
Status: Pending approval
    `,
    start: {
      dateTime: startDateTime,
      timeZone: "America/Toronto",
    },
    end: {
      dateTime: endDateTime,
      timeZone: "America/Toronto",
    },
    attendees: [{ email: instructorEmail }],
  };

  const response = await calendar.events.insert({
    calendarId: instructorEmail,
    requestBody: event,
    sendUpdates: "all",
  });

  return response.data;
}

export const calendar = google.calendar({
  version: "v3",
  auth,
});
