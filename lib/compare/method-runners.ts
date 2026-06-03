import { QUESTION_MAP, PartLabel } from "@/app/lib/questions";
import { getAdaptationRules } from "@/lib/gstar";
import { retrieveFromKB } from "@/lib/retrieval";
import { callCompareLlm } from "@/lib/compare/llm";
import {
  CompareMethod,
  CompareModelConfig,
  CompareProvider,
} from "@/lib/compare/types";

interface MethodRunInput {
  questionId: "M1Q14";
  part: PartLabel;
  studentResponse: string;
  method: CompareMethod;
  candidate: CompareModelConfig;
}

export interface MethodRunResult {
  aiScore: number;
  feedback: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
}

interface ParsedFeedback {
  score?: unknown;
  feedback?: unknown;
  student_feedback?: unknown;
  formative_feedback?: unknown;
  feedback_message?: unknown;
  message?: unknown;
  hint?: unknown;
  guiding_question?: unknown;
  next_step?: unknown;
  confidence?: unknown;
}

const kbCache = new Map<string, Awaited<ReturnType<typeof retrieveFromKB>>>();

interface BoundaryExample {
  credited: string;
  notCredited: string;
  boundary: string;
}

const BOUNDARY_EXAMPLES: Record<string, Partial<Record<PartLabel, BoundaryExample[]>>> = {
  M1Q14: {
    A: [
      {
        credited: "The substance in the cell that determines the order of amino acids is DNA.",
        notCredited: "The substance that determines the order of amino acids is carboxylic.",
        boundary:
          "Credit identifies DNA or DNA-derived mRNA as the source of amino acid order; do not credit unrelated molecules or vague cell parts.",
      },
    ],
    B: [
      {
        credited:
          "The order dictates the folding pattern of the protein, which changes its shape and function.",
        notCredited:
          "The amino acid sequence affects the structure because however the sequence is determines the structure.",
        boundary:
          "Credit requires a real structural mechanism such as folding or 3-D shape; a circular restatement is not enough.",
      },
    ],
    C: [
      {
        credited:
          "Each protein serves a different unique function in the body, such as cell signaling and metabolism.",
        notCredited: "Different parts of the cell need different proteins.",
        boundary:
          "Credit connects protein variety to specific different functions; do not credit a vague need for different proteins without explaining functional diversity.",
      },
    ],
  },
};

function normalizeScore(value: unknown, maxScore: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(maxScore, Math.round(value)));
}

function extractText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value)) {
    const parts = value.map(extractText).filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join(" ") : null;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = [
      "feedback",
      "student_feedback",
      "formative_feedback",
      "feedback_message",
      "message",
      "text",
      "hint",
      "cue",
      "guiding_question",
      "next_step",
    ];
    for (const key of keys) {
      const text = extractText(record[key]);
      if (text) return text;
    }
    const parts = Object.values(record)
      .map(extractText)
      .filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join(" ") : null;
  }
  return null;
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}

function normalizedFeedback(parsed: ParsedFeedback): string {
  return (
    extractText(parsed.feedback) ??
    extractText(parsed.student_feedback) ??
    extractText(parsed.formative_feedback) ??
    extractText(parsed.feedback_message) ??
    extractText(parsed.message) ??
    extractText(parsed.hint) ??
    extractText(parsed.guiding_question) ??
    extractText(parsed.next_step) ??
    "No feedback returned."
  );
}

function normalizedMethod3Feedback(parsed: ParsedFeedback, score: number, maxScore: number): string {
  const direct = normalizedFeedback(parsed);
  if (direct !== "No feedback returned.") return direct;

  return score >= maxScore
    ? "Your response addresses the main biological idea for this part. Check that your wording clearly connects your idea to the prompt."
    : "Your response needs a clearer connection to the biological idea this part is asking about. Reread the prompt and revise by explaining the relevant relationship, function, or mechanism.";
}

function formatBoundaryExamples(examples: BoundaryExample[]) {
  if (examples.length === 0) return "(No boundary examples available for this part.)";

  return examples
    .map((example, index) =>
      [
        `Boundary Pair ${index + 1}`,
        `Credited response: "${example.credited}"`,
        `Not credited response: "${example.notCredited}"`,
        `Boundary rule: ${example.boundary}`,
      ].join("\n")
    )
    .join("\n\n");
}

async function getKbContext(partPrompt: string, studentResponse: string) {
  const key = `${partPrompt}\n---\n${studentResponse}`;
  if (!kbCache.has(key)) {
    kbCache.set(key, await retrieveFromKB(partPrompt, studentResponse, 2));
  }
  return kbCache.get(key) ?? null;
}

async function runMethod1(input: MethodRunInput): Promise<MethodRunResult> {
  const question = QUESTION_MAP[input.questionId];
  const part = question.parts.find((candidate) => candidate.label === input.part);
  if (!part) throw new Error(`Unknown part: ${input.part}`);

  const t0 = Date.now();
  const adaptationRules = getAdaptationRules(question.standard, input.part);
  const useGradeOpt = Boolean(adaptationRules);
  const kbContext = await getKbContext(part.prompt, input.studentResponse);
  const useKB = kbContext !== null;
  const isMultiPoint = part.maxScore > 1;

  const receiveItems: string[] = [
    "1. The question stem",
    "2. The sub-part prompt",
  ];
  let itemNum = 2;
  if (!useGradeOpt) receiveItems.push(`${++itemNum}. Official scoring guidance`);
  if (useGradeOpt) receiveItems.push(`${++itemNum}. GradeOpt Adaptation Rules`);
  if (useKB) {
    receiveItems.push(`${++itemNum}. STEELS standard context (KD1)`);
    receiveItems.push(`${++itemNum}. Scoring rubric context (KD2)`);
    receiveItems.push(`${++itemNum}. Similar scored examples (KE)`);
  }
  receiveItems.push(`${++itemNum}. Student response`);

  const systemPrompt = [
    "You are an expert biology teacher grading a Pennsylvania Keystone Biology Constructed Response item.",
    "",
    "You will receive:",
    ...receiveItems,
    "",
    "Scoring rules:",
    "- CRITICAL: A response phrased as a question (e.g. 'DNA?', 'the ribosome?') scores 0 regardless of content. A response must be a complete declarative sentence to earn any credit.",
    isMultiPoint
      ? `- This part is worth ${part.maxScore} points. Award 0, 1, or ${part.maxScore} based on distinct scorable elements.`
      : "- This part is worth 1 point. Award 0 or 1.",
    !useGradeOpt ? "- Base your score on the scoring guidance." : null,
    useGradeOpt ? "- Adaptation Rules take precedence where they conflict with base guidance." : null,
    useKB
      ? "- Use the STEELS standard context ONLY to understand the biological domain. Do NOT use it to expand the scoring criteria beyond what the sub-part prompt explicitly asks. Each part is scored independently."
      : null,
    useKB ? "- Use the scoring rubric context to apply the correct criteria." : null,
    useKB ? "- Use the scored examples as reference. Find the closest match to the student's response." : null,
    "",
    "FEEDBACK STYLE (apply to every feedback response):",
    "- Write like a warm, encouraging biology teacher talking directly to a student.",
    "- Maximum 35 words total.",
    "- Short sentences. Plain words.",
    "- For score=0: start by acknowledging what the student got partially right before redirecting. Use 'but' to pivot, not 'The missing step is'. Example tone: 'Ribosomes do help build proteins, but they follow instructions - what molecule actually carries those instructions?'",
    "- For score=1: be specific and genuinely affirming. Example tone: 'Correct - DNA carries the genetic code that tells the cell which amino acids to use.'",
    "- Never start with 'I', 'The missing step', 'Your response', or 'This response'.",
    "- No academic jargon. No textbook phrasing.",
    "",
    "STUDENT STATE CLASSIFICATION (classify before writing feedback):",
    "- blank: response is empty, 'I don't know', a single uncontextualized word, or shows no biological reasoning",
    "- wrong_concept: response names a specific wrong substance, process, or organism",
    "- missing_mechanism: correct concept identified but no causal chain or process explained",
    "- missing_specificity: correct direction but too vague to earn credit",
    "- partial_credit: multi-point part where student addressed only some of the required elements",
    "- correct: response earns full credit for this part",
    "",
    "SCAFFOLDING FEEDBACK RULES by taskType and studentState:",
    "",
    "The taskType for this part is: recall_identify",
    "",
    "IF studentState = correct:",
    "  Write exactly 1 declarative sentence.",
    "  Start with 'Correct -' or 'That's right -'.",
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
    "  [explain_mechanism]: 'You have part of the picture - [student's answer] is involved, but what is the step that directly causes [the outcome asked about]?'",
    "  [apply_concept / synthesis_design]: 'That approach works in a different context. Here, think about [specific biological principle at play]. How does that principle apply to [scenario]?'",
    "",
    "IF studentState = missing_mechanism:",
    "  [explain_mechanism]: 'You have identified [correct concept they mentioned]. Now trace one more step - what does [X] physically or chemically do to produce [the outcome]?'",
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
    "  Then: 'For the second part, think about a completely different [dimension / type of evidence / aspect of the system] - not [what they already described], but something that measures [a different outcome].'",
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
    "Be specific to biology content. Name the molecule, process, or mechanism that is missing or wrong.",
    "Format: '[Student believed/wrote X] but [correct concept] is required because [one-line biological reason].'",
    "Write 'none' if score equals maximum points.",
    "",
    "Respond with ONLY valid JSON in this exact format:",
    "{",
    '  "reasoning": "<2-4 sentences: what did the student write, what does the rubric require, where does the response succeed or fall short>",',
    '  "score": <integer>,',
    '  "studentState": "<one of: blank | wrong_concept | missing_mechanism | missing_specificity | partial_credit | correct>",',
    '  "feedback": "<string - see scaffolding rules below>",',
    '  "diagnosedGap": "<string>"',
    "}",
    'Write "reasoning" FIRST before deciding score.',
    "The reasoning field must be 2-4 sentences of explicit biological analysis before you commit to a score.",
    "reasoning and studentState are internal only. Never show them to the student.",
  ]
    .filter(Boolean)
    .join("\n");

  const userPrompt = [
    `QUESTION STEM:\n${question.stem}`,
    `SUB-PART ${input.part} (worth ${part.maxScore} pt${part.maxScore > 1 ? "s" : ""}):\n${part.prompt}`,
    !useGradeOpt ? `SCORING GUIDANCE:\n${part.scoringGuidance}` : null,
    useGradeOpt ? `GRADEOPT ADAPTATION RULES:\n${adaptationRules}` : null,
    kbContext ? `STEELS STANDARD CONTEXT (what this question assesses):\n${kbContext.kd1}` : null,
    kbContext ? `SCORING RUBRIC CONTEXT (official criteria for this part):\n${kbContext.kd2}` : null,
    kbContext ? `SIMILAR SCORED EXAMPLES (use as reference for scoring):\n${kbContext.ke}` : null,
    `STUDENT RESPONSE:\n${input.studentResponse.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await callCompareLlm({
    provider: input.candidate.provider,
    modelId: input.candidate.modelId,
    temperature: input.candidate.temperature,
    jsonMode: true,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  const parsed = parseJsonObject(res.text) as ParsedFeedback;

  return {
    aiScore: normalizeScore(parsed.score, part.maxScore),
    feedback: normalizedFeedback(parsed),
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    totalTokens: res.totalTokens,
    latencyMs: Date.now() - t0,
  };
}

async function runMethod2(input: MethodRunInput): Promise<MethodRunResult> {
  const question = QUESTION_MAP[input.questionId];
  const part = question.parts.find((candidate) => candidate.label === input.part);
  if (!part) throw new Error(`Unknown part: ${input.part}`);

  const t0 = Date.now();
  const stage1System = [
    "You are a scoring engine for Pennsylvania Keystone Biology",
    "constructed-response questions. You score student responses",
    "using item-specific scoring rubrics.",
    "",
    "YOUR ONLY JOB:",
    "Determine how many points the student's response earns for one",
    "part. Output a structured JSON score object only.",
    "Do not address the student. Do not provide feedback.",
    "Do not explain your reasoning in prose.",
    "",
    "THE CORE SCORING TEST:",
    "Ask exactly one question:",
    '"Is the correct biological concept present in this response?"',
    `Award an integer score from 0 to ${part.maxScore}.`,
    "",
    "The rubric's concept field defines what correct means.",
    "The student does not need exact wording or technical terms.",
    "Any accurate biological path to the same concept earns credit,",
    "including plain language descriptions.",
    "",
    "CEILING RULE:",
    "The concept field sets the ceiling, not the floor.",
    "Do NOT require scientific terminology if plain language conveys",
    "the same concept. Do NOT require multi-step explanations if the",
    "concept is stated simply. Do NOT require mechanisms the concept",
    "field does not mention. A short correct answer earns the same",
    "credit as a long one.",
    "",
    "PLAIN LANGUAGE RULE:",
    "Students are 9th-10th graders writing under timed conditions.",
    "Accept plain language equivalents of any concept the rubric lists.",
    "",
    "WHAT DOES NOT DISQUALIFY A RESPONSE:",
    "Spelling errors, grammar errors, plain language instead of",
    "scientific terminology, incomplete elaboration when the concept",
    "is present, brief responses when the concept is correct,",
    "circular phrasing when the correct concept is identifiable,",
    "additional incorrect information alongside a correct concept.",
    "",
    "FAILURE CLASSIFICATION (required when score is 0):",
    "Assign exactly one failure_type when score is 0:",
    '- "wrong_concept": student names a biologically incorrect concept',
    '- "vague": response contains no identifiable biological concept',
    '- "off_task": true biological fact but does not answer what was asked',
    '- "circular": response uses the conclusion as the reason',
    '- "copied_question": rephrases the question without adding biology',
    "",
    "SCORING RULE:",
    part.maxScore > 1
      ? `This part is worth ${part.maxScore} points. Award intermediate credit when the response addresses some, but not all, distinct scorable elements.`
      : "This part is worth exactly 1 point.",
    "",
    "Output JSON only, no markdown:",
    '{"score":0,"failure_type":null}',
  ].join("\n");
  const stage1User = [
    `Question stimulus: ${question.stem}`,
    "",
    `Part ${input.part} prompt: ${part.prompt}`,
    "",
    "Rubric:",
    part.scoringGuidance,
    "",
    "Student response:",
    input.studentResponse.trim() || "(no response)",
  ].join("\n");

  const stage1 = await callCompareLlm({
    provider: input.candidate.provider,
    modelId: input.candidate.modelId,
    temperature: input.candidate.temperature,
    jsonMode: true,
    messages: [
      { role: "system", content: stage1System },
      { role: "user", content: stage1User },
    ],
  });
  const stage1Parsed = parseJsonObject(stage1.text);
  const score = normalizeScore(stage1Parsed.score, part.maxScore);

  const stage2System = [
    "You are a biology tutoring feedback agent for Keystone Biology",
    "constructed-response questions. Generate feedback for one",
    "scored part based on the score and failure type.",
    "",
    "FEEDBACK RULES BY FAILURE TYPE:",
    "",
    `Full credit (${part.maxScore}/${part.maxScore}): Write one sentence confirming what the student got right.`,
    "Be specific. Name what they said that earned the point.",
    "",
    "Partial credit (score > 0 but not full credit):",
    "State what the student got right, then name the missing idea",
    "needed for full credit.",
    "",
    "Score 0 - wrong_concept:",
    "Name what the student said. State it is not the right concept",
    "for this question. Redirect without giving the answer.",
    'Template: "Your response mentions [what student said], but this',
    "part is asking about [correct territory]. Think about",
    '[orienting question pointing toward the concept]."',
    "",
    "Score 0 - vague:",
    "Acknowledge any direction if present. Ask one specific",
    "follow-up question pushing one level deeper toward naming",
    "a mechanism or structure.",
    'Template: "Your response does not name a specific biological',
    "process or mechanism. What specifically [mechanism-level",
    '[question about the topic]?"',
    "",
    "Score 0 - off_task:",
    "Name what their response describes. Clarify what the question",
    "is actually asking.",
    'Template: "Your response describes [what they wrote], which is',
    "accurate about [topic] - but this part is asking [what was",
    'actually asked]. Try focusing on [what kind of answer is needed]."',
    "",
    "Score 0 - circular:",
    "Tell the student their response uses the conclusion as the reason.",
    "Ask them to identify the underlying biological mechanism.",
    'Template: "Your response restates the outcome rather than',
    "explaining the biology behind it. Why does [concept from",
    'their response] happen at the molecular/cellular/organismal level?"',
    "",
    "Score 0 - copied_question:",
    "Tell the student they rephrased the question without adding",
    "biology. Ask them to explain the underlying science.",
    "",
    "FEEDBACK LENGTH: Maximum 2 sentences per part.",
    "",
    "JSON contract: feedback must be one single student-facing string, not an object, array, list, or nested field.",
    "",
    "Output JSON only, no markdown:",
    '{"feedback":"feedback string"}',
  ].join("\n");
  const stage2User = [
    `Question stimulus: ${question.stem}`,
    "",
    `Part ${input.part} prompt: ${part.prompt}`,
    "",
    "Rubric:",
    part.scoringGuidance,
    "",
    "Student response:",
    input.studentResponse.trim() || "(no response)",
    "",
    "Scoring result:",
    JSON.stringify(stage1Parsed, null, 2),
  ].join("\n");

  const stage2 = await callCompareLlm({
    provider: input.candidate.provider,
    modelId: input.candidate.modelId,
    temperature: input.candidate.temperature,
    jsonMode: true,
    messages: [
      { role: "system", content: stage2System },
      { role: "user", content: stage2User },
    ],
  });
  const stage2Parsed = parseJsonObject(stage2.text) as ParsedFeedback;

  return {
    aiScore: score,
    feedback: normalizedFeedback(stage2Parsed),
    inputTokens: stage1.inputTokens + stage2.inputTokens,
    outputTokens: stage1.outputTokens + stage2.outputTokens,
    totalTokens: stage1.totalTokens + stage2.totalTokens,
    latencyMs: Date.now() - t0,
  };
}

async function runMethod3(input: MethodRunInput): Promise<MethodRunResult> {
  const question = QUESTION_MAP[input.questionId];
  const part = question.parts.find((candidate) => candidate.label === input.part);
  if (!part) throw new Error(`Unknown part: ${input.part}`);

  const t0 = Date.now();
  const boundaryExamples = BOUNDARY_EXAMPLES[input.questionId]?.[input.part] ?? [];

  const systemPrompt = [
    "You are an expert Keystone Biology constructed-response grader.",
    "Use the item-specific rubric as the sole scoring authority.",
    "Boundary examples illustrate how to apply the rubric; they do not override it.",
    "Surface errors such as spelling, grammar, and minor wording issues must not affect the score unless they prevent meaning.",
    "",
    "Your output order is mandatory:",
    "1. error_analysis",
    "2. feedback",
    "3. score",
    "4. confidence",
    "",
    "Error analysis rules:",
    "- conceptual_errors: biological misconceptions or incorrect concepts that affect score.",
    "- reasoning_gaps: missing links, mechanisms, or required details that affect score.",
    "- surface_errors: spelling, grammar, or wording issues that do not affect score.",
    "- off_task_or_vague: responses that are too vague or do not answer the prompt.",
    "",
    "Feedback rules:",
    "- Write 1-3 student-facing sentences.",
    "- Keep feedback task-focused, specific to the student's response, and non-judgmental.",
    "- Prioritize elaborated feedback: briefly explain why the current response is or is not sufficient, rather than only saying whether it is right or wrong.",
    "- Address three formative questions implicitly: what the prompt is asking, how the student's response currently matches or misses it, and what kind of revision move to try next.",
    "- If the response has a useful partial idea, name that idea briefly; do not add generic praise.",
    "- Do not comment on the student's ability, effort, intelligence, confidence, or personality.",
    "- If the response is not full credit, do NOT give away the exact missing answer, correct term, or full solution.",
    "- Instead, provide one actionable next step: compare two ideas, connect cause to effect, identify a function, specify a mechanism, or check whether the response answers the exact prompt.",
    "- Use at most one guiding question. It should be specific enough to guide revision but should not contain the answer.",
    "- For a conceptual error, point out the mismatch without naming the correct concept outright.",
    "- For a reasoning gap, ask for the missing relationship, mechanism, evidence, or comparison rather than supplying it.",
    "- For an off-task or vague response, redirect the student to what the prompt is asking them to explain.",
    "- Do not reveal rubric text, boundary example labels, scores, or internal analysis categories.",
    "- JSON contract: feedback must be one single student-facing string, not an object, array, list, or nested field.",
    "",
    `Score must be an integer from 0 to ${part.maxScore}.`,
    "",
    "Respond with ONLY valid JSON:",
    '{"error_analysis":{"conceptual_errors":[],"reasoning_gaps":[],"surface_errors":[],"off_task_or_vague":[]},"feedback":"feedback string","score":0,"confidence":"high|medium|low"}',
  ].join("\n");
  const userPrompt = [
    `Question stimulus:\n${question.stem}`,
    "",
    `Part ${input.part} prompt (${part.maxScore} point${part.maxScore > 1 ? "s" : ""}):\n${part.prompt}`,
    "",
    `Item-specific rubric:\n${part.scoringGuidance}`,
    "",
    `Boundary examples from the Keystone sampler:\n${formatBoundaryExamples(boundaryExamples)}`,
    "",
    `Student response:\n${input.studentResponse.trim() || "(no response)"}`,
  ].join("\n");

  const res = await callCompareLlm({
    provider: input.candidate.provider,
    modelId: input.candidate.modelId,
    temperature: input.candidate.temperature,
    jsonMode: true,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  const parsed = parseJsonObject(res.text) as ParsedFeedback;
  const score = normalizeScore(parsed.score, part.maxScore);

  return {
    aiScore: score,
    feedback: normalizedMethod3Feedback(parsed, score, part.maxScore),
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    totalTokens: res.totalTokens,
    latencyMs: Date.now() - t0,
  };
}

export async function runComparisonMethod(input: MethodRunInput): Promise<MethodRunResult> {
  if (input.method === "1") return runMethod1(input);
  if (input.method === "2") return runMethod2(input);
  return runMethod3(input);
}

export function providerDisplayName(provider: CompareProvider): string {
  if (provider === "openai") return "OpenAI";
  if (provider === "anthropic") return "Anthropic";
  return "Google";
}
