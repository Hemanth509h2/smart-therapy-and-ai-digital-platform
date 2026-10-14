// Survey + quick-question types shared by the browser and the server.
// The questions themselves live in the database (survey_questions / quick_questions) and are edited in /admin.

export type QuestionKind = "scale" | "single" | "multi" | "text";

export const KIND_LABELS: Record<QuestionKind, string> = {
  scale: "Rating scale",
  single: "Single choice",
  multi: "Multiple choice",
  text: "Text answer",
};

export type Question = {
  id: string;
  position: number;
  kind: QuestionKind;
  title: string;
  options: string[];
  scale_min: number | null;
  scale_max: number | null;
  low_label: string | null;
  high_label: string | null;
  required: boolean;
  active: boolean;
};

/** An answer as sent by the form: a number (scale), a string (single / text) or a string list (multi). */
export type AnswerValue = number | string | string[];

export type QuickQuestion = { id: string; position: number; question: string; options: string[]; version: number; active: boolean };
export type QuickResult = QuickQuestion & { total: number; counts: Record<string, number> };
