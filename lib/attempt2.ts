import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function classifyResolution(
  attempt1Gap: string,
  attempt2Response: string,
  model: string
): Promise<"fully" | "partially" | "not_at_all"> {
  const res = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "Classify whether a student's revised biology response addresses a specific reasoning gap. Respond with exactly one of: fully / partially / not_at_all",
      },
      {
        role: "user",
        content: `Gap from attempt 1: ${attempt1Gap}\n\nStudent attempt 2: ${attempt2Response}`,
      },
    ],
  });
  const raw = res.choices[0].message.content?.trim().toLowerCase() ?? "";
  if (raw.startsWith("not") || raw.includes("not_at_all") || raw.includes("not at all"))
    return "not_at_all";
  if (raw.startsWith("partial") || raw.includes("partial")) return "partially";
  return "fully";
}

export interface Attempt2Options {
  resolution: "fully" | "partially" | "not_at_all";
  attempt1Feedback: string;
  attempt1Gap: string;
  questionStem: string;
  partLabel: string;
  partPrompt: string;
  studentResponse: string;
  model: string;
}

export async function handleAttempt2(
  options: Attempt2Options
): Promise<{ feedback: string; tokenCount: number }> {
  const {
    resolution,
    attempt1Feedback,
    attempt1Gap,
    questionStem,
    partLabel,
    partPrompt,
    studentResponse,
    model,
  } = options;

  const feedbackInstruction =
    resolution === "fully"
      ? [
          "IF resolution = fully:",
          "The student has now correctly answered the question.",
          "Write 1 sentence acknowledging the specific concept they correctly identified this time. Be warm and specific.",
        ].join("\n")
      : resolution === "partially"
      ? [
          "IF resolution = partially:",
          "Do not ask a question.",
          "Acknowledge what they got right in sentence 1.",
          "In sentence 2, state the missing piece directly as a fact — do not hint, just complete the reasoning.",
          "Maximum 2 sentences. No question mark.",
        ].join("\n")
      : [
          "IF resolution = not_at_all:",
          "Do not ask a question.",
          "Instead, complete the reasoning for the student.",
          "Identify the specific step they missed and state it clearly as a declarative sentence.",
          "Format: '[What they got right, if anything.] [The missing step stated directly.]'",
          "Maximum 2 sentences. No question mark.",
        ].join("\n");

  const feedbackSystemPrompt = [
    "You are giving targeted feedback on a student's second attempt at a Keystone Biology question.",
    "",
    `Gap resolution: ${resolution}`,
    "",
    feedbackInstruction,
    "",
    `HARD CONSTRAINT: Do not reuse any phrases, sentence structures, or vocabulary from this previous feedback: "${attempt1Feedback}"`,
    "",
    "Return only the feedback text. No JSON, no labels.",
  ].join("\n");

  const feedbackUserPrompt = [
    `Question: ${questionStem}`,
    `Part ${partLabel}: ${partPrompt}`,
    `What was missing (attempt 1): ${attempt1Gap}`,
    `Student attempt 2 response: ${studentResponse}`,
  ].join("\n");

  const feedbackCompletion = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: feedbackSystemPrompt },
      { role: "user", content: feedbackUserPrompt },
    ],
  });

  return {
    feedback: feedbackCompletion.choices[0].message.content?.trim() ?? "No feedback returned.",
    tokenCount: feedbackCompletion.usage?.total_tokens ?? 0,
  };
}
