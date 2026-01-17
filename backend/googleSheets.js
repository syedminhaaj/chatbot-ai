import { google } from "googleapis";

const auth = new google.auth.GoogleAuth({
  keyFile: "google-service-account.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

const sheets = google.sheets({ version: "v4", auth });

const SPREADSHEET_ID = "11W7HZvPVm6Nqlnz8wK1_y7H5DKdZMLjv8AWA0yW4Q-Y";

export async function getInstructors() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Instructors!A2:D",
  });

  return res.data.values.map((row) => ({
    name: row[0],
    email: row[1],
    calendarId: row[2],
    active: row[3] === "YES",
  }));
}

export async function getAvailability() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Availability!A2:D",
  });

  return res.data.values.map((row) => ({
    instructor: row[0],
    day: row[1],
    start: row[2],
    end: row[3],
  }));
}
