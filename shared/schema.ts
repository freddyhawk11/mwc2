// Shared types between client and server (storage uses raw better-sqlite3 tables).

export type Member = {
  id: number;
  name: string;
  email: string;
  isAdmin: boolean;
  color: string;
  ntfyTopic: string;
};

export type DayStatus = "done" | "missed" | "pending" | "forecast" | "none";

export type CalendarDay = {
  date: string; // YYYY-MM-DD
  status: DayStatus;
  memberId: number | null; // planned / responsible person
  doneBy: number | null;
  skipped: number[];
};

export type TodayInfo = {
  date: string;
  taskName: string;
  status: "pending" | "done" | "missed";
  assigneeId: number | null;
  doneBy: number | null;
  doneAt: string | null;
  skipped: number[];
  notifyHour: number;
  upcoming: { date: string; memberId: number }[];
  counts: Record<number, number>;
  queue: number[];
};

export type SettingsInfo = {
  taskName: string;
  notifyHour: number;
  publicUrl: string;
  cronKey: string;
  queue: number[];
};
