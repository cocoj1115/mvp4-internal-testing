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
    "- For score=1: write exactly ONE confirmatory sentence ending with '!'.",
    "- For score=1: choose naturally from these openers — do NOT always default to the same one: 'Exactly right,' / 'Nice work,' / 'Good job,' / 'Yes,' / 'That's right,' / 'Well done,'.",
    "- For score=1: name the exact concept the student got right and connect it to the student's own wording.",
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
    "FEEDBACK PLANNING (complete all steps before writing feedback):",
    "",
    "Step 1 — studentAnchor: copy the shortest useful phrase from the student response. If the student wrote nothing useful (blank, 'I don't know'), set studentAnchor = null.",
    "",
    "Step 2 — if score = 1:",
    "  correctnessTarget = the exact concept, relationship, or mechanism the student correctly expressed.",
    "  feedbackDraft = one sentence: '[opener], [studentAnchor] correctly [identifies / explains / shows] [correctnessTarget]!'",
    "  feedback = feedbackDraft verbatim. Do not add anything.",
    "",
    "Step 3 — if score = 0:",
    "  specificityTarget = the single concept, location, function, or causal link the student needs for this sub-part. Name it precisely (e.g. 'the role of R side chain interactions in protein folding', not 'the mechanism').",
    "  hintTarget = rephrase specificityTarget as a category or function WITHOUT using the final answer term. (e.g. if specificityTarget = 'DNA', hintTarget = 'the molecule in the nucleus that stores genetic instructions')",
    "  feedbackDraft = apply the scaffolding rule for this taskType and studentState, inserting studentAnchor and hintTarget.",
    "  manageabilityCheck = count the number of distinct teaching moves in feedbackDraft. If > 1, delete everything except the move targeting hintTarget.",
    "  specificityCheck = confirm that hintTarget appears explicitly in feedbackDraft. If it does not, rewrite feedbackDraft to include it.",
    "  feedback = the final output after manageabilityCheck and specificityCheck.",
    "",
    // ── scaffolding rules ─────────────────────────────────────────────────────
    "SCAFFOLDING FEEDBACK RULES by taskType and studentState:",
    "",
    `The taskType for this part is: ${taskType ?? "recall_identify"}`,
    "",
    // correct
    "IF studentState = correct:",
    "  Write exactly ONE sentence ending with '!'.",
    "  Use one comma opener from: 'Exactly right,' / 'Nice work,' / 'Good job,' / 'Yes,' / 'That's right,' / 'Well done,' — choose naturally, never default to the same opener.",
    "  Name correctnessTarget and connect it to studentAnchor.",
    "  For recall_identify: '[Opener] [studentAnchor] is exactly the [molecule / structure / process] this part asks for!'",
    "  For explain_mechanism: '[Opener] your explanation that [studentAnchor] correctly captures [correctnessTarget]!'",
    "  No questions, no 'but', no 'however', no extra information, no hints at the next part.",
    "",
    // blank
    "IF studentState = blank:",
    "  Sentence 1: name the two biological components involved in hintTarget — give the student something concrete. Do NOT reveal the answer.",
    "  Sentence 2: ask what happens between those two components, pointing toward hintTarget.",
    "  recall_identify:          'Think about [biological location or category where hintTarget lives]. What [molecule / structure / process] there is responsible for [specific function from prompt]?'",
    "  explain_mechanism:        'Think about what [component A] and [component B] do during [biological process]. What kind of [interaction / change] between them determines [hintTarget outcome]?'",
    "  evaluation_justification: 'Think about what [biological structure / process] does for the cell. What would be lost without [hintTarget]?'",
    "  experimental_design:      'Think about how a scientist would detect [specific variable]. What one measurement would show whether it changed?'",
    "  synthesis_design:         'Think about the target outcome. What first step controls [hintTarget]?'",
    "  Maximum 2 sentences.",
    "",
    // wrong_concept
    "IF studentState = wrong_concept:",
    "  Sentence 1: declarative — use studentAnchor to acknowledge the student's answer has a biological role, but clarify the mismatch with the prompt's function. No question mark.",
    "  Sentence 2: one question about hintTarget only — name the biological location or context.",
    "  Template: '[studentAnchor] is involved in [its actual biological role], but this part asks about [specific function from prompt]. What [molecule / structure / process] is responsible for [hintTarget]?'",
    "  Maximum 2 sentences. Exactly one question mark.",
    "",
    // missing_mechanism
    "IF studentState = missing_mechanism:",
    "  recall_identify:",
    "    Treat as missing_specificity.",
    "    'You described [studentAnchor], but this part asks for the specific [molecule / structure / process]. What is [hintTarget]?'",
    "",
    "  explain_mechanism:",
    "    Sentence 1: acknowledge studentAnchor.",
    "    Sentence 2: ask for one missing causal link only — name the two components explicitly.",
    "    Template: 'You're right that [studentAnchor]. What single [interaction / change / signal] between [component A named from hintTarget] and [component B named from hintTarget] causes that?'",
    "    Exactly 2 sentences. One question mark in sentence 2 only.",
    "",
    "  evaluation_justification:",
    "    'You described [studentAnchor]. What one biological consequence directly supports [hintTarget]?'",
    "",
    "  experimental_design:",
    "    'You have the right variable. What one measurement would show whether [hintTarget] changed?'",
    "",
    "  synthesis_design:",
    "    'Good start with [studentAnchor]. What specific next step controls [hintTarget]?'",
    "",
    // missing_specificity
    "IF studentState = missing_specificity:",
    "  recall_identify:          'You described [studentAnchor], but this part asks for the specific [molecule / structure / process] responsible for [specific function]. What is [hintTarget]?'",
    "  explain_mechanism:        '[studentAnchor] is the outcome. What one [physical / chemical] interaction between [component A from hintTarget] and [component B from hintTarget] produces it?'",
    "  evaluation_justification: 'You have the right idea with [studentAnchor]. What one function would be lost without [hintTarget]?'",
    "  experimental_design:      'You have the right variable. What one measurement would show whether [hintTarget] changed?'",
    "  synthesis_design:         'You have the goal. What specific [cross / mating / step] achieves [hintTarget]?'",
    "",
    // partial_credit
    "IF studentState = partial_credit:",
    "  Only applies to multi-point parts (maxScore > 1) — currently only M2Q15-B.",
    "  Sentence 1: name what was correct using studentAnchor.",
    "  Sentence 2: one targeted hint for the missing element using hintTarget — name a different dimension explicitly.",
    "  Template: 'Well done on [studentAnchor]. For the second measure, focus on [hintTarget] — a completely different dimension from what you described.'",
    "  Do not repeat the same category of answer.",
    "",
    // absolute constraints
    "ABSOLUTE CONSTRAINTS:",
    "- score=1: exactly ONE sentence ending with '!'. No second sentence, no question, no extra teaching.",
    "- score=0: exactly ONE question mark total. Count before finishing.",
    "- score=0: exactly ONE teaching move. If feedbackDraft contains two moves, delete the weaker one.",
    "- Do not reveal the final answer term for recall_identify tasks.",
    "- Do not say 'incorrect', 'wrong', 'you need to'.",
    "- Do not mention rubrics, scoring criteria, or other parts of the question.",
    "- Maximum 2 sentences total.",
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
    '  "studentAnchor": "<shortest useful phrase from student response, or null>",',
    '  "specificityTarget": "<score=0 only: the precise concept, location, function, or causal link needed — internal only>",',
    '  "hintTarget": "<score=0 only: specificityTarget rephrased without the final answer term — internal only>",',
    '  "feedbackDraft": "<the feedback before manageability and specificity checks>",',
    '  "feedback": "<final feedback after checks>",',
    '  "diagnosedGap": "<string>"',
    '}',
    'Write "reasoning" FIRST before deciding score.',
    'reasoning, studentAnchor, specificityTarget, hintTarget, and feedbackDraft are internal only — never shown to the student.',
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
    studentAnchor?: string;
    specificityTarget?: string;
    hintTarget?: string;
    feedbackDraft?: string;
    feedback?: string;
    diagnosedGap?: string;
  };

  const reasoning = typeof scoreParsed.reasoning === "string" ? scoreParsed.reasoning : "";
  console.log(`[method1] CoT reasoning: ${reasoning}`);

  const studentState = typeof scoreParsed.studentState === "string" ? scoreParsed.studentState : "unknown";
  console.log(`[method1] studentState: ${studentState}`);

  const studentAnchor = typeof scoreParsed.studentAnchor === "string" ? scoreParsed.studentAnchor : null;
  console.log(`[method1] studentAnchor: ${studentAnchor}`);

  const specificityTarget = typeof scoreParsed.specificityTarget === "string" ? scoreParsed.specificityTarget : "";
  console.log(`[method1] specificityTarget: ${specificityTarget}`);

  const hintTarget = typeof scoreParsed.hintTarget === "string" ? scoreParsed.hintTarget : "";
  console.log(`[method1] hintTarget: ${hintTarget}`);

  const feedbackDraft = typeof scoreParsed.feedbackDraft === "string" ? scoreParsed.feedbackDraft : "";
  console.log(`[method1] feedbackDraft: ${feedbackDraft}`);

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