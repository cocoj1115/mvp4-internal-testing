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
Does the feedback address the task, not the learner?

| Score | Description |
|---|---|
| 1 | Uses personal or evaluative language ("you don't understand", "you failed to") |
| 2 | Mostly task-focused but contains one evaluative phrase |
| 3 | Task-focused throughout, no personal framing |
| 4 | Addresses specific task features with zero personal language |

**B2. specificity**
Does the feedback clearly connect to the learning goal?

| Score | Task Type | Description |
|---|---|---|
| 1 | Both | Generic — applies to any question ("try again", "think harder") |
| 2 | Recall/Identify | References the topic but not the specific concept being asked |
| 2 | Explain Mechanism | Names a general concept but not the specific gap |
| 3 | Recall/Identify | Names the specific concept or category the student should identify |
| 3 | Explain Mechanism | Names the missing step but without clear connection to student's response |
| 4 | Recall/Identify | Names the specific concept AND links it to the student's misconception |
| 4 | Explain Mechanism | Names the exact missing causal step, linked clearly to student's response |

**B3. manageability**
Is the amount of information appropriate?

| Score | Task Type | Description |
|---|---|---|
| 1 | Recall/Identify | Explains the entire concept — a mini-lesson when one hint would suffice |
| 1 | Explain Mechanism | Addresses multiple gaps or provides overwhelming information |
| 2 | Recall/Identify | Two pieces of information when one would suffice |
| 2 | Explain Mechanism | Addresses two issues; one is primary |
| 3 | Recall/Identify | One focused hint, appropriate length |
| 3 | Explain Mechanism | Focuses on one gap but includes one unnecessary add-on |
| 4 | Recall/Identify | Minimal and targeted — exactly what is needed, nothing extra |
| 4 | Explain Mechanism | One clear focused revision target, no extra information |

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
- task_focus ≥ 3.5
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

## Who maintains this file
Researcher owns this file.
To update dimension definitions: edit this file, then ask
Claude Code to regenerate eval-judge/route.ts from this skill.
Do not edit route.ts dimension strings directly.
