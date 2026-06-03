import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { QUESTION_MAP } from "@/app/lib/questions";
import { getAdaptationRules } from "@/lib/gstar";
import { retrieveFromKB } from "@/lib/retrieval";
import { gradeWithMethod2 } from "@/lib/methods/method2";
import { gradeWithMethod3 } from "@/lib/methods/method3";
import {
  DEFAULT_GRADING_MODEL,
  GradingModel,
  isGradingModel,
} from "@/lib/grading-models";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface GradeRequest {
  questionId: string;
  partLabel: "A" | "B" | "C";
  studentResponse: string;
  method?: string;
  model?: string;
  attemptNumber?: 1 | 2;
  attempt1Feedback?: string;
  attempt1Gap?: string;
  priorGaps?: Record<string, string>;
  taskType?: string;
}

export interface GradeResponse {
  score: number;
  feedback: string;
  tokenCount?: number;
  model?: GradingModel;
  diagnosedGap: string;
  resolution?: "fully" | "partially" | "not_at_all";
}

// ── Helper: classify how well the student addressed attempt 1 gap ──────────

async function classifyResolution(
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

// ── Helper: generate attempt 2 feedback routed by resolution ──────────────

async function generateAttempt2Feedback(
  resolution: "fully" | "partially" | "not_at_all",
  attempt1Feedback: string,
  questionStem: string,
  partLabel: string,
  partPrompt: string,
  studentResponse: string,
  model: string
): Promise<string> {
  const instruction =
    resolution === "fully"
      ? "The student has addressed the gap. Acknowledge specifically what improved. 1–2 sentences."
      : resolution === "partially"
      ? "The student partially addressed the gap. Acknowledge the progress, then note what is still missing. 2 sentences."
      : "The student did not address the gap. Reframe from a completely different angle. 2 sentences max.";

  const res = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: [
          "You are giving feedback on a student's second attempt at a Keystone Biology constructed-response question.",
          instruction,
          "Be encouraging but precise. Do not mention internal scoring criteria or diagnostic labels.",
          `HARD CONSTRAINT: Do not reuse any phrases, sentence structures, or vocabulary from this previous feedback: "${attempt1Feedback}"`,
          "Return only the feedback text — no JSON, no labels, no extra formatting.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Question: ${questionStem}`,
          `Part ${partLabel}: ${partPrompt}`,
          `Student response: ${studentResponse}`,
        ].join("\n"),
      },
    ],
  });
  return res.choices[0].message.content?.trim() ?? "No feedback returned.";
}

// ── Error helpers ─────────────────────────────────────────────────────────

function openAiErrorResponse(err: unknown) {
  if (!(err instanceof OpenAI.APIError)) return null;
  const code = typeof err.code === "string" ? err.code : undefined;
  const status = err.status ?? 500;
  if (status === 429 && code === "insufficient_quota") {
    return NextResponse.json(
      { error: "OpenAI quota exceeded. Check billing and usage limits.", code },
      { status: 429 }
    );
  }
  if (status === 429) {
    return NextResponse.json(
      { error: "OpenAI rate limit reached. Please wait and try again.", code: code ?? "rate_limit" },
      { status: 429 }
    );
  }
  if (status === 401 || status === 403) {
    return NextResponse.json(
      { error: "OpenAI authentication failed. Check OPENAI_API_KEY.", code: code ?? "auth_error" },
      { status }
    );
  }
  return NextResponse.json(
    { error: "OpenAI request failed. Check server logs.", code: code ?? "openai_error" },
    { status }
  );
}

// ── Main handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body: GradeRequest = await req.json();
    const {
      questionId,
      partLabel,
      studentResponse,
      method,
      model,
      attemptNumber = 1,
      attempt1Feedback,
      attempt1Gap,
      priorGaps,
      taskType,
    } = body;

    const gradingModel = model ?? DEFAULT_GRADING_MODEL;
    if (!isGradingModel(gradingModel)) {
      return NextResponse.json({ error: `Unsupported grading model: ${String(gradingModel)}` }, { status: 400 });
    }

    const question = QUESTION_MAP[questionId];
    if (!question) return NextResponse.json({ error: "Unknown question ID" }, { status: 400 });

    const part = question.parts.find((p) => p.label === partLabel);
    if (!part) return NextResponse.json({ error: "Unknown part label" }, { status: 400 });

    if (!studentResponse || studentResponse.trim().length === 0) {
      return NextResponse.json<GradeResponse>({
        score: 0,
        feedback: "No response was submitted.",
        diagnosedGap: "Student submitted empty response.",
        model: gradingModel,
      });
    }

    // ── Method 2 ──────────────────────────────────────────────────────────
    if (method === "2") {
      const result = await gradeWithMethod2(questionId, partLabel, studentResponse, gradingModel);
      const diagnosedGap = result.score >= part.maxScore ? "none" : result.feedback;

      if (attemptNumber === 2 && attempt1Gap) {
        const resolution = await classifyResolution(attempt1Gap, studentResponse, gradingModel);
        const feedback = await generateAttempt2Feedback(
          resolution, attempt1Feedback ?? "", question.stem, partLabel, part.prompt, studentResponse, gradingModel
        );
        return NextResponse.json<GradeResponse>({
          score: result.score, feedback, tokenCount: result.tokenCount,
          model: gradingModel, diagnosedGap, resolution,
        });
      }

      return NextResponse.json<GradeResponse>({
        score: result.score, feedback: result.feedback,
        tokenCount: result.tokenCount, model: gradingModel, diagnosedGap,
      });
    }

    // ── Method 3 ──────────────────────────────────────────────────────────
    if (method === "3") {
      const result = await gradeWithMethod3(questionId, partLabel, studentResponse, gradingModel);
      const diagnosedGap = result.score >= part.maxScore ? "none" : result.feedback;

      if (attemptNumber === 2 && attempt1Gap) {
        const resolution = await classifyResolution(attempt1Gap, studentResponse, gradingModel);
        const feedback = await generateAttempt2Feedback(
          resolution, attempt1Feedback ?? "", question.stem, partLabel, part.prompt, studentResponse, gradingModel
        );
        return NextResponse.json<GradeResponse>({
          score: result.score, feedback, tokenCount: result.tokenCount,
          model: gradingModel, diagnosedGap, resolution,
        });
      }

      return NextResponse.json<GradeResponse>({
        score: result.score, feedback: result.feedback,
        tokenCount: result.tokenCount, model: gradingModel, diagnosedGap,
      });
    }

    // ── Method 1 (and fallback): GradeOpt + RAG ───────────────────────────

    const adaptationRules = method === "1"
      ? getAdaptationRules(question.standard, partLabel)
      : null;
    const useGradeOpt = !!adaptationRules;

    const kbContext = await retrieveFromKB(part.prompt, studentResponse, 2);
    const useKB = kbContext !== null;

    const isMultiPoint = part.maxScore > 1;

    // ── Scoring system prompt (attempt-1 style — used for both attempts) ──
    const receiveItems: string[] = [
      "1. The question stem",
      "2. The sub-part prompt",
    ];
    let itemNum = 2;
    if (!useGradeOpt) receiveItems.push(`${++itemNum}. Official scoring guidance`);
    if (useGradeOpt)  receiveItems.push(`${++itemNum}. GradeOpt Adaptation Rules`);
    if (useKB) {
      receiveItems.push(`${++itemNum}. STEELS standard context (KD1)`);
      receiveItems.push(`${++itemNum}. Scoring rubric context (KD2)`);
      receiveItems.push(`${++itemNum}. Similar scored examples (KE)`);
    }
    receiveItems.push(`${++itemNum}. Student response`);

    const scoringSystemPrompt = [
      "You are an expert biology teacher grading a Pennsylvania Keystone Biology Constructed Response (CR) item.",
      "",
      "You will receive:",
      ...receiveItems,
      "",
      "Scoring rules:",
      "• CRITICAL: A response phrased as a question (e.g. 'DNA?', 'the ribosome?') scores 0 regardless of content — uncertainty is not understanding. A response must be a complete declarative sentence to earn any credit.",
      isMultiPoint
        ? `• This part is worth ${part.maxScore} points. Award 0, 1, or ${part.maxScore} based on distinct scorable elements.`
        : "• This part is worth 1 point. Award 0 or 1.",
      !useGradeOpt ? "• Base your score on the scoring guidance." : null,
      useGradeOpt ? "• Adaptation Rules take precedence where they conflict with base guidance." : null,
      useKB ? "• Use the STEELS standard context ONLY to understand the biological domain — do NOT use it to expand the scoring criteria beyond what the sub-part prompt explicitly asks. Each part is scored independently." : null,
      useKB ? "• Use the scoring rubric context to apply the correct criteria." : null,
      useKB ? "• Use the scored examples as reference — find the closest match to the student's response." : null,
      priorGaps && Object.keys(priorGaps).length > 0
        ? "• Prior part gaps are provided for context only. Use them to make feedback more coherent across parts, but do not change the score based on prior gaps. Score only what this sub-part asks."
        : null,
      "",
      "FEEDBACK STYLE (apply to every feedback response):",
      "- Write like a warm, encouraging biology teacher talking directly to a student.",
      "- Maximum 35 words total.",
      "- Short sentences. Plain words.",
      "- For score=0: start by acknowledging what the student got partially right before redirecting. Use 'but' to pivot, not 'The missing step is'. Example tone: 'Ribosomes do help build proteins, but they follow instructions — what molecule actually carries those instructions?'",
      "- For score=1: be specific and genuinely affirming. Example tone: 'Correct — DNA carries the genetic code that tells the cell which amino acids to use.'",
      "- Never start with 'I', 'The missing step', 'Your response', or 'This response'.",
      "- No academic jargon. No textbook phrasing.",
      "",
      "STUDENT STATE CLASSIFICATION (classify before writing feedback):",
      "- blank: response is empty, 'I don't know', a single uncontextualized word, or shows no biological reasoning",
      "- wrong_concept: response names a specific wrong substance, process, or organism (e.g. ribosome instead of DNA)",
      "- missing_mechanism: correct concept identified but no causal chain or process explained",
      "- missing_specificity: correct direction but too vague to earn credit (e.g. 'proteins do different things')",
      "- partial_credit: multi-point part where student addressed only some of the required elements",
      "- correct: response earns full credit for this part",
      "",
      "SCAFFOLDING FEEDBACK RULES by taskType and studentState:",
      "",
      `The taskType for this part is: ${taskType ?? "recall_identify"}`,
      "",
      "IF studentState = correct:",
      "  Write exactly 1 declarative sentence.",
      "  Start with 'Correct —' or 'That's right —'.",
      "  Name the specific concept correctly identified.",
      "  No questions, no 'but', no 'however', no critique.",
      "",
      "IF studentState = blank:",
      "  Anchor to prior knowledge regardless of taskType.",
      "  Do not ask about the gap directly.",
      "  Template: 'Think about what you know about [biological domain relevant to this part]. [One orienting question that connects prior knowledge to this task].'",
      "  1-2 sentences max.",
      "",
      "IF studentState = wrong_concept:",
      "  [recall_identify]: 'That [student's answer] has a different role in the cell. What molecule in [relevant location] actually carries [function being asked about]?'",
      "  [explain_mechanism]: 'You have part of the picture — [student's answer] is involved, but what is the step that directly causes [the outcome asked about]?'",
      "  [apply_concept / synthesis_design]: 'That approach works in a different context. Here, think about [specific biological principle at play]. How does that principle apply to [scenario]?'",
      "",
      "IF studentState = missing_mechanism:",
      "  [explain_mechanism]: Acknowledge the outcome the student described (e.g. shape, structure, function). Then name the category of the missing piece (e.g. 'interaction', 'bond', 'property') to lead them toward it — do NOT ask an open-ended question and do NOT reveal the specific term.",
      "  Template: 'You're right that [outcome they described]. To get full credit, name the specific [interaction / bond / property] between [relevant components] that causes that to happen.'",
      "  This must be a declarative sentence completing their answer, not a quiz question. Maximum 2 sentences.",
      "  [experimental_design]: 'You have the right variable in mind. How would a researcher actually measure or observe whether [X] changed?'",
      "  [synthesis_design]: 'Good starting point. What is the next step in the sequence that makes this work [biologically / genetically]?'",
      "  [evaluation_justification]: 'You have made a claim. What specific biological consequence or function supports that claim?'",
      "",
      "IF studentState = missing_specificity:",
      "  [recall_identify]: Do NOT ask for an example. 'Can you name the specific [molecule / structure / process] rather than describing its general role?'",
      "  [explain_mechanism]: 'You have described the outcome. What is the specific [physical / chemical] interaction that produces it?'",
      "  [evaluation_justification]: 'You have the right idea. What specific function would be lost or impossible without [the thing they mentioned]?'",
      "  [synthesis_design]: 'You have the goal. What specific [cross / action / step] achieves it, and why does that work [genetically / ecologically]?'",
      "",
      "IF studentState = partial_credit:",
      "  Only applies to multi-point parts (maxScore > 1).",
      "  Acknowledge what was correct explicitly.",
      "  Then: 'For the second part, think about a completely different [dimension / type of evidence / aspect of the system] — not [what they already described], but something that measures [a different outcome].'",
      "  Do not repeat the same category of answer.",
      "",
      "ABSOLUTE CONSTRAINTS for all states except correct:",
      "- Your entire feedback response must contain exactly ONE question mark total. Count before you finish. If you have written two questions, combine them into one or delete the second.",
      "- Do not reveal the answer",
      "- Do not say 'incorrect', 'wrong', 'you need to'",
      "- Do not mention rubrics, scoring criteria, or other parts of the question",
      "- Do not ask more than one question per feedback",
      "- Maximum 2 sentences",
      "",
      "diagnosedGap: Identify the single most important reasoning step or concept the student failed to demonstrate.",
      "Be specific to biology content — name the molecule, process, or mechanism that is missing or wrong.",
      "Format: '[Student believed/wrote X] but [correct concept] is required because [one-line biological reason].'",
      "Write 'none' if score equals maximum points.",
      "",
      'Respond with ONLY valid JSON in this exact format:',
      '{',
      '  "reasoning": "<2-4 sentences: what did the student write, what does the rubric require, where does the response succeed or fall short>",',
      '  "score": <integer>,',
      '  "studentState": "<one of: blank | wrong_concept | missing_mechanism | missing_specificity | partial_credit | correct>",',
      '  "feedback": "<string — see scaffolding rules below>",',
      '  "diagnosedGap": "<string>"',
      '}',
      'Write "reasoning" FIRST before deciding score.',
      'The reasoning field must be 2-4 sentences of explicit biological analysis before you commit to a score.',
      'reasoning and studentState are internal only — never shown to the student.',
    ].filter((l) => l !== null).join("\n");

    // ── Scoring user prompt (attempt-1 style — no attempt-2 context) ──────
    const scoringUserParts = [
      `QUESTION STEM:\n${question.stem}`,
      `SUB-PART ${partLabel} (worth ${part.maxScore} pt${part.maxScore > 1 ? "s" : ""}):\n${part.prompt}`,
      !useGradeOpt ? `SCORING GUIDANCE:\n${part.scoringGuidance}` : null,
      useGradeOpt ? `GRADEOPT ADAPTATION RULES:\n${adaptationRules}` : null,
      Object.keys(priorGaps ?? {}).length > 0
        ? `PRIOR PART GAPS (context only — do not re-grade, do not penalize, use only to inform feedback tone):\n${Object.entries(priorGaps ?? {}).map(([label, gap]) => `Part ${label}: ${gap}`).join("\n")}`
        : null,
      kbContext ? `STEELS STANDARD CONTEXT (what this question assesses):\n${kbContext.kd1}` : null,
      kbContext ? `SCORING RUBRIC CONTEXT (official criteria for this part):\n${kbContext.kd2}` : null,
      kbContext ? `SIMILAR SCORED EXAMPLES (use as reference for scoring):\n${kbContext.ke}` : null,
      `STUDENT RESPONSE:\n${studentResponse.trim()}`,
    ].filter(Boolean);

    // ── Call 1: Score (+ diagnosedGap) ───────────────────────────────────
    const scoreCompletion = await client.chat.completions.create({
      model: gradingModel,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: scoringSystemPrompt },
        { role: "user", content: scoringUserParts.join("\n\n") },
      ],
    });

    const scoreRaw = scoreCompletion.choices[0].message.content ?? "{}";
    const scoreParsed = JSON.parse(scoreRaw) as { reasoning?: string; score?: unknown; studentState?: string; feedback?: string; diagnosedGap?: string };

    const reasoning = typeof scoreParsed.reasoning === "string" ? scoreParsed.reasoning : "";
    console.log(`[grade] CoT reasoning: ${reasoning}`);

    const studentState = typeof scoreParsed.studentState === "string" ? scoreParsed.studentState : "unknown";
    console.log(`[grade] studentState: ${studentState}`);

    const rawScore = typeof scoreParsed.score === "number" ? scoreParsed.score : 0;
    const score = Math.max(0, Math.min(part.maxScore, Math.round(rawScore)));
    const diagnosedGap =
      typeof scoreParsed.diagnosedGap === "string" && scoreParsed.diagnosedGap.trim()
        ? scoreParsed.diagnosedGap.trim()
        : "none";

    // ── Attempt 1: feedback comes from the scoring call ───────────────────
    if (attemptNumber === 1) {
      const feedback =
        typeof scoreParsed.feedback === "string" && scoreParsed.feedback.length > 0
          ? scoreParsed.feedback
          : "No feedback returned.";

      return NextResponse.json<GradeResponse>({
        score,
        feedback,
        diagnosedGap,
        tokenCount: scoreCompletion.usage?.total_tokens,
        model: gradingModel,
      });
    }

    // ── Attempt 2: classify resolution, then separate feedback call ───────
    const resolution = await classifyResolution(
      attempt1Gap ?? diagnosedGap,
      studentResponse,
      gradingModel
    );

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
      `HARD CONSTRAINT: Do not reuse any phrases, sentence structures, or vocabulary from this previous feedback: "${attempt1Feedback ?? ""}"`,
      "",
      "Return only the feedback text. No JSON, no labels.",
    ].join("\n");

    const feedbackUserPrompt = [
      `Question: ${question.stem}`,
      `Part ${partLabel}: ${part.prompt}`,
      `What was missing (attempt 1): ${attempt1Gap ?? diagnosedGap}`,
      `Student attempt 2 response: ${studentResponse}`,
    ].join("\n");

    // ── Call 2: Feedback only ─────────────────────────────────────────────
    const feedbackCompletion = await client.chat.completions.create({
      model: gradingModel,
      temperature: 0,
      messages: [
        { role: "system", content: feedbackSystemPrompt },
        { role: "user", content: feedbackUserPrompt },
      ],
    });

    const feedback = feedbackCompletion.choices[0].message.content?.trim() ?? "No feedback returned.";

    return NextResponse.json<GradeResponse>({
      score,
      feedback,
      diagnosedGap,
      tokenCount: (scoreCompletion.usage?.total_tokens ?? 0) + (feedbackCompletion.usage?.total_tokens ?? 0),
      model: gradingModel,
      resolution,
    });
  } catch (err) {
    console.error("[/api/grade] Error:", err);
    const openAiResponse = openAiErrorResponse(err);
    if (openAiResponse) return openAiResponse;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
