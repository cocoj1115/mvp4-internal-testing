# Ref1-FeedbackRubric

## What this skill is for
Use this whenever writing any code that calls an LLM
to evaluate AI-generated feedback quality in BioBridge.
This includes: eval-judge/route.ts, any judge helper functions,
and any prompt construction related to feedback evaluation.

Read this file completely before writing any judge-related code.

---

## Judge Configuration

- Model: GPT-5.4
- Temperature: 0 (always — never changes with test config)
- Response format: json_object
- Called once per feedback string, after grading completes
- The request body includes `score` (0 or 1) and `taskType`
  The judge must apply the correct rubric based on these fields

---

## Two Rubric Tracks

### Track A — Score = 1 (Correct Response)
Feedback after a correct response should be brief and confirmatory.
Only two dimensions matter:

**A1. confirmation_clarity**
Does the feedback clearly confirm what the student got right?

| Score | Description |
|---|---|
| 1 | Vague or generic ("good job", "correct") — does not name what was right |
| 2 | Names the general topic but not the specific concept |
| 3 | Names the specific concept the student correctly identified |
| 4 | Names the specific concept AND connects it precisely to the student's wording |

**A2. scope_control**
Does the feedback stay focused on confirming this part only?

| Score | Description |
|---|---|
| 1 | Introduces new information, asks follow-up questions, or hints at next part |
| 2 | Mostly confirmatory but contains one unnecessary addition |
| 3 | Stays on this part but slightly longer than needed |
| 4 | Exactly one confirmatory sentence, nothing extra |

Output format for Track A:
```json
{
  "track": "correct",
  "confirmation_clarity": <1|2|3|4>,
  "scope_control": <1|2|3|4>,
  "overall_quality": <1|2|3|4>,
  "rationale": "<one sentence on biggest weakness>"
}
```

---

### Track B — Score = 0 (Incorrect Response)
Feedback after an incorrect response must guide without revealing.
Four dimensions, split by task type where relevant:

**B1. task_focus**
Does the feedback avoid evaluating the student as a person rather than the task?

| Score | Description |
|---|---|
| 1 | Explicitly judges the student as a person or their ability (e.g., "you don't understand", "you failed to", "you clearly didn't think") |
| 2 | Contains one phrase that could be read as judging the student rather than the task (e.g., "you should know this", "you missed the point") |
| 3 | No personal judgement, but feedback is generic — addresses the task without referencing what the student actually wrote |
| 4 | No personal judgement, and feedback directly references the student's response to redirect ("you identified X, but the question asks about Y") |

**B2. specificity**
Does the feedback clearly connect to the learning goal?

| Score | Task Type | Description |
|---|---|---|
| 1 | Both | Generic — could apply to any biology question ("try again", "think harder", "be more specific") |
| 2 | Recall/Identify | References the biological topic but not the specific concept being asked (e.g. "think about DNA" when the answer is mRNA) |
| 2 | Explain Mechanism | Names a general concept but not the specific causal step that is missing |
| 3 | Recall/Identify | Names the specific concept or category the student should identify, without referencing what the student wrote |
| 3 | Explain Mechanism | Names the specific missing causal step, without referencing what the student wrote |
| 4 | Recall/Identify | Names the specific concept AND explicitly connects it to what the student wrote (e.g. "ribosomes build proteins, but what carries the instructions?") |
| 4 | Explain Mechanism | Names the exact missing causal step AND explicitly connects it to the outcome the student described |

**B3. manageability**
Is the amount of information appropriate?

| Score | Task Type | Description |
|---|---|---|
| 1 | Recall/Identify | Explains the full concept or gives multiple hints when one would suffice |
| 1 | Explain Mechanism | Addresses multiple gaps or asks for multiple causal steps at once |
| 2 | Recall/Identify | One hint plus one extra piece of information that is not needed |
| 2 | Explain Mechanism | Focuses on one gap but also introduces a second issue or asks a follow-up |
| 3 | Recall/Identify | One hint plus one brief context sentence that sets it up (acceptable) |
| 3 | Explain Mechanism | One gap targeted but includes one unnecessary phrase or qualifier |
| 4 | Recall/Identify | Exactly one targeted hint, nothing else |
| 4 | Explain Mechanism | Exactly one causal step targeted, no add-ons, no extra context |

**B4. answer_leakage**
Does the feedback preserve productive struggle?

| Score | Description |
|---|---|
| 1 | Directly states the correct answer or key term |
| 2 | Implies the answer strongly through leading questions |
| 3 | Guides without revealing — one hint is slightly too direct |
| 4 | Full productive struggle preserved — student must still reason to the answer |

Output format for Track B:
```json
{
  "track": "incorrect",
  "task_focus": <1|2|3|4>,
  "specificity": <1|2|3|4>,
  "manageability": <1|2|3|4>,
  "answer_leakage": <1|2|3|4>,
  "overall_quality": <1|2|3|4>,
  "rationale": "<one sentence on biggest weakness>"
}
```

---

## System Prompt

Use this exact system prompt for the judge call:

```
You are an expert evaluator of formative feedback in science education.

You will receive:
- A biology question part and prompt
- The student's response
- The AI score (0 = incorrect, 1 = correct)
- The task type (recall_identify or explain_mechanism)
- The AI-generated feedback to evaluate

If score = 1: apply Track A rubric (confirmation_clarity, scope_control).
If score = 0: apply Track B rubric (task_focus, specificity, 
  manageability, answer_leakage). For specificity and manageability,
  apply the row that matches the task type provided.

Be strict — a score of 4 should be rare and genuinely excellent.
Return ONLY valid JSON matching the track format. No markdown.
```

---

## User Prompt Template

```
QUESTION PART: {partLabel}
TASK TYPE: {taskType}
QUESTION PROMPT: {partPrompt}
STUDENT RESPONSE: {studentResponse}
AI SCORE: {score}
AI FEEDBACK TO EVALUATE: {feedback}
```

---

## Pass Thresholds (for CSV export)

Track A:
- confirmation_clarity ≥ 3
- scope_control ≥ 3

Track B:
- task_focus ≥ 3.0
- specificity ≥ 3.0
- manageability ≥ 3.0
- answer_leakage ≥ 3.0

A row passes if ALL dimensions for its track meet the threshold.

---

## Implementation Notes for Claude Code

- Read `score` and `taskType` from the request body
- Route to Track A or Track B based on score
- Pass taskType into the user prompt so GPT applies the correct
  row of the specificity and manageability rubrics
- Parse the JSON response strictly — if any field is missing,
  default to 1 (not null)
- The rationale field is included in the CSV export
- Judge latency should be measured and stored separately
  from grading latency
- If the judge call fails, store null for all dimension scores
  and log the error — do not block CSV export
- The `track` field in the response should be stored in the
  results row for filtering in CSV export
