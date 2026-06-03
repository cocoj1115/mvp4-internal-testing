import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function resolveGap(
  diagnosedGap: string,
  attempt2Response: string
): Promise<"fully" | "partially" | "not at all"> {
  const completion = await client.chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You are evaluating whether a student addressed a specific reasoning gap in their revised response.",
      },
      {
        role: "user",
        content: `Diagnosed gap from attempt 1: ${diagnosedGap}\nStudent's attempt 2 response: ${attempt2Response}\nDid the student address the diagnosed gap?\nAnswer with exactly one of: fully / partially / not at all`,
      },
    ],
  });

  const raw = completion.choices[0].message.content?.trim().toLowerCase() ?? "";
  if (raw.includes("not at all")) return "not at all";
  if (raw.includes("partially")) return "partially";
  if (raw.includes("fully")) return "fully";
  return "not at all";
}

export interface Method1Options {
  adaptationRules: string | null;
  kbContext: { kd1: string; kd2: string; ke: string } | null;
  priorGaps: Record<string, string>;
  taskType: string | undefined;
  part: { prompt: string; maxScore: number; scoringGuidance: string };
  questionStem: string;
}

export interface Method1Result {
  score: number;
  feedback: string;
  diagnosedGap: string;
  tokenCount: number;
}

export async function gradeWithMethod1(
  _questionId: string,
  partLabel: "A" | "B" | "C",
  studentResponse: string,
  model: string,
  options: Method1Options
): Promise<Method1Result> {
  const { adaptationRules, kbContext, priorGaps, taskType, part, questionStem } = options;

  const useGradeOpt = !!adaptationRules;
  const useKB = kbContext !== null;
  const isMultiPoint = part.maxScore > 1;

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
    "- Maximum 30 words total.",
    "- Short sentences. Plain words.",
    "- For score=0: start by acknowledging what the student got partially right before redirecting. Use 'but' to pivot, not 'The missing step is'. Example tone: 'Ribosomes do help build proteins, but they follow instructions — what molecule actually carries those instructions?'",
    "- For score=1: be specific and genuinely affirming. Example tone: 'Correct — DNA carries the genetic code that tells the cell which amino acids to use.'",
    "- Never start with 'I', 'The missing step', 'Your response', or 'This response'.",
    "- No long and complicated setences. No academic jargon. No textbook phrasing.",
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

  const scoringUserParts = [
    `QUESTION STEM:\n${questionStem}`,
    `SUB-PART ${partLabel} (worth ${part.maxScore} pt${part.maxScore > 1 ? "s" : ""}):\n${part.prompt}`,
    !useGradeOpt ? `SCORING GUIDANCE:\n${part.scoringGuidance}` : null,
    useGradeOpt ? `GRADEOPT ADAPTATION RULES:\n${adaptationRules ?? ""}` : null,
    Object.keys(priorGaps ?? {}).length > 0
      ? `PRIOR PART GAPS (context only — do not re-grade, do not penalize, use only to inform feedback tone):\n${Object.entries(priorGaps ?? {}).map(([label, gap]) => `Part ${label}: ${gap}`).join("\n")}`
      : null,
    kbContext ? `STEELS STANDARD CONTEXT (what this question assesses):\n${kbContext.kd1}` : null,
    kbContext ? `SCORING RUBRIC CONTEXT (official criteria for this part):\n${kbContext.kd2}` : null,
    kbContext ? `SIMILAR SCORED EXAMPLES (use as reference for scoring):\n${kbContext.ke}` : null,
    `STUDENT RESPONSE:\n${studentResponse.trim()}`,
  ].filter(Boolean);

  const scoreCompletion = await client.chat.completions.create({
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: scoringSystemPrompt },
      { role: "user", content: scoringUserParts.join("\n\n") },
    ],
  });

  const scoreRaw = scoreCompletion.choices[0].message.content ?? "{}";
  const scoreParsed = JSON.parse(scoreRaw) as {
    reasoning?: string;
    score?: unknown;
    studentState?: string;
    feedback?: string;
    diagnosedGap?: string;
  };

  const reasoning = typeof scoreParsed.reasoning === "string" ? scoreParsed.reasoning : "";
  console.log(`[method1] CoT reasoning: ${reasoning}`);

  const studentState = typeof scoreParsed.studentState === "string" ? scoreParsed.studentState : "unknown";
  console.log(`[method1] studentState: ${studentState}`);

  const rawScore = typeof scoreParsed.score === "number" ? scoreParsed.score : 0;
  const score = Math.max(0, Math.min(part.maxScore, Math.round(rawScore)));
  const diagnosedGap =
    typeof scoreParsed.diagnosedGap === "string" && scoreParsed.diagnosedGap.trim()
      ? scoreParsed.diagnosedGap.trim()
      : "none";

  const feedback =
    typeof scoreParsed.feedback === "string" && scoreParsed.feedback.length > 0
      ? scoreParsed.feedback
      : "No feedback returned.";

  return {
    score,
    feedback,
    diagnosedGap,
    tokenCount: scoreCompletion.usage?.total_tokens ?? 0,
  };
}
