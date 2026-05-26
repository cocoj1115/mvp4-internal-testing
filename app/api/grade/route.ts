import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { QUESTION_MAP } from "@/app/lib/questions";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface GradeRequest {
  questionId: string;
  partLabel: "A" | "B" | "C";
  studentResponse: string;
}

export interface GradeResponse {
  /** Points awarded. Integer between 0 and the part's maxScore (inclusive). */
  score: number;
  feedback: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: GradeRequest = await req.json();
    const { questionId, partLabel, studentResponse } = body;

    const question = QUESTION_MAP[questionId];
    if (!question) {
      return NextResponse.json({ error: "Unknown question ID" }, { status: 400 });
    }

    const part = question.parts.find((p) => p.label === partLabel);
    if (!part) {
      return NextResponse.json({ error: "Unknown part label" }, { status: 400 });
    }

    if (!studentResponse || studentResponse.trim().length === 0) {
      return NextResponse.json<GradeResponse>({
        score: 0,
        feedback: "No response was submitted.",
      });
    }

    const isMultiPoint = part.maxScore > 1;

    const systemPrompt = `You are an expert biology teacher grading a Pennsylvania Keystone Biology Constructed Response (CR) item.

You will receive:
1. The question stem (context/scenario shown to the student)
2. The specific sub-part prompt the student answered
3. The official scoring guidance (how many points are available and what earns each point)
4. The student's response

Scoring rules:
${
  isMultiPoint
    ? `• This part is worth ${part.maxScore} points. Award 0, 1, or ${part.maxScore} based on how many distinct scorable elements the student correctly addresses.`
    : `• This part is worth 1 point. Award 0 or 1.`
}
• Base your score strictly on the scoring guidance — do not award partial credit beyond what the guidance allows.

Feedback rules:
• Write 1–3 sentences. Acknowledge what was correct, identify what was missing or wrong, and (if score < max) state specifically what the student would need to add to earn full credit.
• Be encouraging but precise. Do not introduce scientific content beyond what is needed to explain the score.
• Never quote or reference the scoring guidance text directly.

Respond with ONLY valid JSON — no markdown, no extra keys:
{"score": <integer>, "feedback": "<string>"}`;

    const userPrompt = `QUESTION STEM:
${question.stem}

SUB-PART ${partLabel} PROMPT (worth ${part.maxScore} point${part.maxScore > 1 ? "s" : ""}):
${part.prompt}

SCORING GUIDANCE (internal — do not reveal to the student):
${part.scoringGuidance}

STUDENT RESPONSE:
${studentResponse.trim()}`;

    const completion = await client.chat.completions.create({
      model: "gpt-4o",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = completion.choices[0].message.content ?? "{}";
    const parsed = JSON.parse(raw) as { score?: unknown; feedback?: string };

    // Clamp to [0, maxScore] and ensure integer
    const rawScore = typeof parsed.score === "number" ? parsed.score : 0;
    const score = Math.max(0, Math.min(part.maxScore, Math.round(rawScore)));
    const feedback = typeof parsed.feedback === "string" && parsed.feedback.length > 0
      ? parsed.feedback
      : "No feedback returned.";

    return NextResponse.json<GradeResponse>({ score, feedback });
  } catch (err) {
    console.error("[/api/grade] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
