import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function resolveGap(
  diagnosedGap: string,
  attempt2Response: string,
  model: string
): Promise<"fully" | "partially" | "not at all"> {
  const completion = await client.chat.completions.create({
    model,
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
    "FEEDBACK STYLE (apply to every feedback response):",
    "- Tone: warm and encouraging, like a supportive biology teacher — not cold, not overly casual.",
    "- Maximum 35 words total.",
    "- Keep sentences short and direct. Do NOT use complex relative clauses or multi-clause sentences.",
    "- Academic terminology is allowed when it is standard textbook vocabulary (e.g. 'amino acid', 'folding', 'allele'). Do not avoid it — just keep the sentence structure simple around it.",
    "- For score=0: acknowledge what the student got partially right before redirecting. Use 'but' to pivot. Example: 'Ribosomes do help build proteins, but they follow instructions — what molecule actually carries those instructions?'",
    "- For score=1: be specific and genuinely affirming. Vary the opening — do NOT always use 'Correct'. Rotate through: 'Exactly right.' / 'Nice work.' / 'Good job.' / 'Yes!' / 'That's right.' / 'Well done.' — use a period or exclamation mark, never a dash. Match the warmth to the effort.",
    "- Never start with 'I', 'The missing step', 'Your response', or 'This response'.",
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
    // ── correct ──────────────────────────────────────────────────────────────
    "IF studentState = correct:",
    "  Write exactly 1 declarative sentence.",
    "  Start with one of: 'Exactly right.' / 'Nice work.' / 'Good job.' / 'Yes!' / 'That's right.' / 'Well done.' — use a period or exclamation mark, never a dash.",
    "  Name the specific concept correctly identified.",
    "  No questions, no 'but', no 'however', no critique.",
    "",
    // ── blank ─────────────────────────────────────────────────────────────────
    "IF studentState = blank:",
    "  Do not ask about the gap directly.",
    "  recall_identify:        'Think about what you know about [biological domain]. What [molecule / structure / process] is responsible for [the function this part asks about]?'",
    "  explain_mechanism:      'Think about what you know about [biological process]. What happens step by step when [trigger or condition] occurs?'",
    "  evaluation_justification: 'Think about what [biological structure / process] does for the cell or organism. What would be lost or impossible without it?'",
    "  experimental_design:    'Think about how a scientist would know whether [variable] changed. What could they observe or measure?'",
    "  synthesis_design:       'Think about what outcome is being targeted. What is the first step that controls [the relevant biological variable]?'",
    "  1-2 sentences max.",
    "",
    // ── wrong_concept ─────────────────────────────────────────────────────────
    "IF studentState = wrong_concept:",
    "  First sentence: declarative — acknowledge that the student's answer has a real role in biology, but clarify it applies to a different function or context. This must NOT be a question.",
    "  Second sentence: one redirecting question that names the biological location or context where the correct answer lives.",
    "  Template: '[Student's answer] is involved in [different function], not [what this part asks about]. What [molecule / structure / process] in [relevant biological location or context] is responsible for [function being asked]?'",
    "  Maximum 2 sentences. Exactly one question mark total.",
    "",
    // ── missing_mechanism ─────────────────────────────────────────────────────
    "IF studentState = missing_mechanism:",
    "  recall_identify: treat as missing_specificity — student has the right domain but needs the specific term.",
    "    'You are thinking about the right area. Can you name the specific [molecule / structure] rather than describing what it does?'",
    "",
    "  explain_mechanism:",
    "    The student identified an outcome but not the causal chain.",
    "    Sentence 1: acknowledge what the student correctly described.",
    "    Sentence 2: provide a causal scaffold — name the two components involved and ask what happens between them. Do NOT reveal the specific term. Do NOT ask an open-ended 'why' or 'what causes everything' question.",
    "    Template: 'You're right that [outcome they described]. Think about what happens between [component A] and [component B] — what kind of [interaction / change / signal] causes that?'",
    "    Exactly 2 sentences. Second sentence is the only question.",
    "",
    "  evaluation_justification: 'You have made a claim. What specific biological consequence or function directly supports that claim?'",
    "",
    "  experimental_design: 'You have the right variable in mind. How would a researcher actually observe or measure whether [X] changed?'",
    "",
    "  synthesis_design: 'Good start. What is the specific next step in the sequence, and why does that step control [the relevant biological outcome]?'",
    "",
    // ── missing_specificity ───────────────────────────────────────────────────
    "IF studentState = missing_specificity:",
    "  recall_identify:          'You are thinking about the right area. Can you name the specific [molecule / structure / process] rather than describing its general role?'",
    "  explain_mechanism:        'You have described the outcome. What is the specific [physical / chemical] interaction between [relevant components] that produces it?'",
    "  evaluation_justification: 'You have the right idea. What specific function or consequence would be lost without [the thing they mentioned]?'",
    "  experimental_design:      'You have the right variable. What specific measurement or observation would show whether it changed?'",
    "  synthesis_design:         'You have the goal. What specific [cross / mating / step] achieves it, and why does that work genetically?'",
    "",
    // ── partial_credit ────────────────────────────────────────────────────────
    "IF studentState = partial_credit:",
    "  Only applies to multi-point parts (maxScore > 1) — currently only M2Q15-B.",
    "  Acknowledge what was correct explicitly by naming it.",
    "  Then: 'For the second measure, think about a completely different aspect of the system — not [what they already described], but something that captures [a different outcome or dimension].'",
    "  Do not repeat the same category of answer.",
    "",
    // ── absolute constraints ──────────────────────────────────────────────────
    "ABSOLUTE CONSTRAINTS for all states except correct:",
    "- Your entire feedback response must contain exactly ONE question mark total. Count before you finish. If you have written two questions, combine them into one or delete the second.",
    "- Do not reveal the answer.",
    "- Do not say 'incorrect', 'wrong', 'you need to'.",
    "- Do not mention rubrics, scoring criteria, or other parts of the question.",
    "- Do not ask more than one question per feedback.",
    "- Maximum 2 sentences.",
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
    '  "feedback": "<string — see scaffolding rules above>",',
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