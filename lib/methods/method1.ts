import { chatComplete } from "@/lib/llm";

export async function resolveGap(
  diagnosedGap: string,
  attempt2Response: string,
  model: string,
  temperature?: number
): Promise<"fully" | "partially" | "not at all"> {
  const result = await chatComplete({
    model,
    temperature,
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

  const raw = result.content.trim().toLowerCase();
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
  temperature: number | undefined;
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
  const { adaptationRules, kbContext, priorGaps, taskType, temperature, part, questionStem } = options;

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
    // ── scoring rules ─────────────────────────────────────────────────────────
    "SCORING RULES:",
    "• CRITICAL: A response phrased as a question (e.g. 'DNA?', 'the ribosome?') scores 0 regardless of content — uncertainty is not understanding.",
    taskType === "recall_identify"
      ? "• For recall_identify tasks: a single correct term or phrase (e.g. 'DNA', 'mRNA') earns full credit — a complete sentence is not required."
      : "• For this task type, a response must be a complete declarative sentence to earn any credit — a single word or phrase is insufficient.",
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
    // ── feedback style ────────────────────────────────────────────────────────
    "FEEDBACK STYLE:",
    "- Tone: warm and encouraging, like a supportive biology teacher — not cold, not overly casual.",
    "- Maximum 35 words total.",
    "- Keep sentences short and direct. Do NOT use complex relative clauses or multi-clause sentences.",
    "- Academic terminology is allowed when it is standard textbook vocabulary (e.g. 'amino acid', 'folding', 'allele'). Do not avoid it — just keep the sentence structure simple around it.",
    "- For score=0: acknowledge what the student got partially right before redirecting. Use 'but' to pivot.",
    "- For score=1: be specific and genuinely affirming. Vary the opening — rotate through: 'Exactly right.' / 'Nice work.' / 'Good job.' / 'Yes!' / 'That's right.' / 'Well done.' — use a period or exclamation mark, never a dash.",
    "- Never start with 'I', 'The missing step', 'Your response', or 'This response'.",
    "",
    // ── student state ─────────────────────────────────────────────────────────
    "STUDENT STATE CLASSIFICATION (classify before writing feedback):",
    "- blank: response is empty, 'I don't know', a single uncontextualized word, or shows no biological reasoning",
    "- wrong_concept: response names a specific wrong substance, process, or organism (e.g. ribosome instead of DNA)",
    "- missing_mechanism: correct concept identified but no causal chain or process explained",
    "- missing_specificity: correct direction but too vague to earn credit (e.g. 'proteins do different things')",
    "- partial_credit: multi-point part where student addressed only some of the required elements",
    "- correct: response earns full credit for this part",
    "",
    // ── feedback planning ─────────────────────────────────────────────────────
    "FEEDBACK PLANNING (do this before writing feedback):",
    "Step 1 — identify specificityTarget: the single most important concept, category, location, or causal step the student needs next. Take it from diagnosedGap. Phrase it as a hint category, not the answer itself.",
    "Step 2 — identify studentAnchor: the most relevant phrase the student actually wrote that you can connect the hint to. If the student wrote nothing useful, studentAnchor is null.",
    "Step 3 — write feedback using specificityTarget and studentAnchor only. Do not introduce any other biological content.",
    "Step 4 — manageability check: feedback must contain exactly one hint (specificityTarget). Delete any clause that is not needed to guide the student toward specificityTarget. No mini-lessons, no second gaps, no extra causes or consequences.",
    "Step 5 — specificity check: the feedback must name specificityTarget explicitly in student-facing language. Replace any generic redirect ('think about the process', 'be more specific', 'what happens next') with the actual target.",
    "",
    // ── scaffolding rules ─────────────────────────────────────────────────────
    "SCAFFOLDING FEEDBACK RULES by taskType and studentState:",
    "",
    `The taskType for this part is: ${taskType ?? "recall_identify"}`,
    "",
    // correct
    "IF studentState = correct:",
    "  Write exactly 1 declarative sentence.",
    "  Start with one of: 'Exactly right.' / 'Nice work.' / 'Good job.' / 'Yes!' / 'That's right.' / 'Well done.' — use a period or exclamation mark, never a dash.",
    "  Name the specific concept correctly identified.",
    "  No questions, no 'but', no 'however', no critique.",
    "",
    // blank
    "IF studentState = blank:",
    "  Sentence 1: name the two biological components involved in specificityTarget — this gives the student something concrete to hold onto. Do not reveal the answer.",
    "  Sentence 2: ask what happens between those two components, pointing toward specificityTarget.",
    "  recall_identify:          'Think about [biological domain of this part]. What [molecule / structure / process] is responsible for [specificityTarget function]?'",
    "  explain_mechanism:        'Think about what [component A] and [component B] do when [biological process occurs]. What kind of [interaction / change] between them determines [specificityTarget outcome]?'",
    "  evaluation_justification: 'Think about what [biological structure / process] does for the cell. What would be lost without [specificityTarget]?'",
    "  experimental_design:      'Think about how a scientist would detect change. What one measurement would show whether [specificityTarget] changed?'",
    "  synthesis_design:         'Think about the target outcome. What first step controls [specificityTarget]?'",
    "  Maximum 2 sentences.",
    "",
    // wrong_concept
    "IF studentState = wrong_concept:",
    "  Sentence 1: declarative — use studentAnchor to acknowledge the student's answer has a biological role, but name the different function it serves. Do NOT use a question mark.",
    "  Sentence 2: one question pointing to specificityTarget only. Name the biological location or context where the correct answer lives.",
    "  Template: '[studentAnchor] is involved in [its actual biological role], not [function this part asks about]. What [molecule / structure / process] in [biological context] is responsible for [specificityTarget]?'",
    "  Maximum 2 sentences. Exactly one question mark.",
    "",
    // missing_mechanism
    "IF studentState = missing_mechanism:",
    "  recall_identify:",
    "    Treat as missing_specificity. Student has the right domain but needs the specific term.",
    "    'You are describing [studentAnchor general idea], but this part asks for the specific [molecule / structure]. What is [specificityTarget]?'",
    "",
    "  explain_mechanism:",
    "    Sentence 1: use studentAnchor to acknowledge what the student correctly described.",
    "    Sentence 2: ask for the single missing causal link (specificityTarget) only — do not ask for the full sequence.",
    "    Template: 'You're right that [studentAnchor outcome]. What single [interaction / change / signal] between [component A] and [component B] causes [specificityTarget]?'",
    "    Exactly 2 sentences. One question mark in sentence 2 only.",
    "",
    "  evaluation_justification: 'You have described [studentAnchor]. What one biological consequence directly supports that [specificityTarget]?'",
    "",
    "  experimental_design: 'You have the right variable. What one measurement would show whether [specificityTarget] changed?'",
    "",
    "  synthesis_design: 'Good start with [studentAnchor]. What specific next step controls [specificityTarget]?'",
    "",
    // missing_specificity
    "IF studentState = missing_specificity:",
    "  recall_identify:          'You described [studentAnchor], but this part asks for the specific [molecule / structure / process]. What is [specificityTarget]?'",
    "  explain_mechanism:        '[studentAnchor] is the outcome. What one [physical / chemical] interaction between [component A] and [component B] produces [specificityTarget]?'",
    "  evaluation_justification: 'You have the right idea with [studentAnchor]. What one function would be lost without [specificityTarget]?'",
    "  experimental_design:      'You have the right variable. What one measurement would show whether [specificityTarget] changed?'",
    "  synthesis_design:         'You have the goal. What specific [cross / mating / step] achieves [specificityTarget]?'",
    "",
    // partial_credit
    "IF studentState = partial_credit:",
    "  Only applies to multi-point parts (maxScore > 1) — currently only M2Q15-B.",
    "  Sentence 1: name what was correct using studentAnchor.",
    "  Sentence 2: give one targeted hint for the missing element only — name specificityTarget directly.",
    "  'Well done on [studentAnchor]. For the second measure, think about [specificityTarget] — a different dimension from what you already described.'",
    "  Do not repeat the same category of answer.",
    "",
    // absolute constraints
    "ABSOLUTE CONSTRAINTS for all states except correct:",
    "- Exactly ONE question mark total. Count before finishing.",
    "- Do not reveal the answer.",
    "- Do not say 'incorrect', 'wrong', 'you need to'.",
    "- Do not mention rubrics, scoring criteria, or other parts of the question.",
    "- Exactly one hint (specificityTarget). No second gap, no mini-lesson, no extra cause or consequence.",
    "- CRITICAL: Do NOT name the specificityTarget answer directly in feedback. specificityTarget tells you WHAT to hint at, not WHAT to say. For recall_identify blank: name the biological category or location, not the molecule itself. Example: for specificityTarget=DNA, say 'Think about what in the nucleus carries genetic instructions' — not 'What molecule is DNA?'",
    "- Maximum 2 sentences.",
    "",
    // json format
    "diagnosedGap: the single most important reasoning step or concept the student failed to demonstrate.",
    "Be specific — name the molecule, process, or mechanism that is missing or wrong.",
    "Format: '[Student believed/wrote X] but [correct concept] is required because [one-line biological reason].'",
    "Write 'none' if score equals maximum points.",
    "",
    'Respond with ONLY valid JSON in this exact format:',
    '{',
    '  "reasoning": "<2-4 sentences: what did the student write, what does the rubric require, where does the response succeed or fall short>",',
    '  "score": <integer>,',
    '  "studentState": "<one of: blank | wrong_concept | missing_mechanism | missing_specificity | partial_credit | correct>",',
    '  "specificityTarget": "<the exact concept, category, location, or causal step the feedback targets — internal only>",',
    '  "studentAnchor": "<the phrase from the student response used to connect the hint — null if blank>",',
    '  "feedback": "<string>",',
    '  "diagnosedGap": "<string>"',
    '}',
    'Write "reasoning" FIRST before deciding score.',
    'reasoning, specificityTarget, and studentAnchor are internal only — never shown to the student.',
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

  const scoreCompletion = await chatComplete({
    model,
    temperature,
    jsonMode: true,
    messages: [
      { role: "system", content: scoringSystemPrompt },
      { role: "user", content: scoringUserParts.join("\n\n") },
    ],
  });

  const scoreRaw = scoreCompletion.content ?? "{}";
  const scoreParsed = JSON.parse(scoreRaw) as {
    reasoning?: string;
    score?: unknown;
    studentState?: string;
    specificityTarget?: string;
    studentAnchor?: string;
    feedback?: string;
    diagnosedGap?: string;
  };

  const reasoning = typeof scoreParsed.reasoning === "string" ? scoreParsed.reasoning : "";
  console.log(`[method1] CoT reasoning: ${reasoning}`);

  const studentState = typeof scoreParsed.studentState === "string" ? scoreParsed.studentState : "unknown";
  console.log(`[method1] studentState: ${studentState}`);

  const specificityTarget = typeof scoreParsed.specificityTarget === "string" ? scoreParsed.specificityTarget : "";
  console.log(`[method1] specificityTarget: ${specificityTarget}`);

  const studentAnchor = typeof scoreParsed.studentAnchor === "string" ? scoreParsed.studentAnchor : null;
  console.log(`[method1] studentAnchor: ${studentAnchor}`);

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
    tokenCount: scoreCompletion.tokenCount,
  };
}