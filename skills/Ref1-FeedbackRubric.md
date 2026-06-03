## What this skill is for
Use this whenever writing any code that calls an LLM
to evaluate AI-generated feedback quality
This includes: eval-judge/route.ts, any judge helper functions,
and any prompt construction related to feedback evaluation.

Read this file completely before writing any judge-related code.

---

## Judge Configuration

- Model: GPT-5.4
- Temperature: 0 (always — never changes with test config)
- Response format: json_object
- Called once per feedback string, after grading completes

---

## System Prompt

Use this exact system prompt for the judge call:

```
You are an expert evaluator of formative feedback in science 
education. You will receive a student response to a biology 
question and the AI-generated feedback that followed.

Score the feedback on five dimensions using the rubrics below.
Be strict — a score of 4 should be rare and genuinely excellent.

Return ONLY valid JSON. No markdown. No explanation outside 
the rationale field.
```

---

## Five Evaluation Dimensions

### 1. task_focus
Does the feedback address the task, not the learner?

| Score | Description |
|---|---|
| 1 | Uses personal or evaluative language ("you don't understand", "you failed to") |
| 2 | Mostly task-focused but contains one evaluative phrase |
| 3 | Task-focused throughout, no personal framing |
| 4 | Addresses specific task features with zero personal language |

### 2. specificity
Does the feedback name the exact missing reasoning step?

| Score | Description |
|---|---|
| 1 | Generic or vague — no missing step named ("try again", "think harder") |
| 2 | Names a general concept but not the specific gap |
| 3 | Names the missing step but without clear connection to what the student wrote |
| 4 | Names the exact missing reasoning step and links it clearly to the student's response |

### 3. manageability
Is the feedback focused on one thing?

| Score | Description |
|---|---|
| 1 | Addresses multiple gaps or provides a mini-lesson |
| 2 | Addresses two issues, one is primary |
| 3 | Focuses on one gap but includes one unnecessary add-on |
| 4 | One clear focused revision target, nothing extra |

### 4. answer_leakage
Does the feedback preserve productive struggle?

| Score | Description |
|---|---|
| 1 | Directly states the correct answer or key term |
| 2 | Implies the answer strongly through leading questions |
| 3 | Guides without revealing — one hint is slightly too direct |
| 4 | Full productive struggle preserved — student must still reason to the answer |

### 5. overall_quality
Holistic alignment with formative feedback principles.

| Score | Description |
|---|---|
| 1 | Unhelpful — likely to confuse or discourage |
| 2 | Partially helpful — student may benefit with effort |
| 3 | Helpful and likely to support revision |
| 4 | Highly effective — specific, actionable, task-focused, struggle-preserving |

---

## User Prompt Template

```
QUESTION PART: {partLabel}
QUESTION PROMPT: {partPrompt}
STUDENT RESPONSE: {studentResponse}
AI FEEDBACK TO EVALUATE: {feedback}
```

---

## Output Format

The judge must return exactly this JSON structure:

```json
{
  "task_focus": <1|2|3|4>,
  "specificity": <1|2|3|4>,
  "manageability": <1|2|3|4>,
  "answer_leakage": <1|2|3|4>,
  "overall_quality": <1|2|3|4>,
  "rationale": "<one sentence identifying the single biggest weakness in this feedback>"
}
```

---

## Implementation Notes for Claude Code

- The judge call is always a separate API call from the grading call
- Never reuse the grading model or temperature for the judge
- Parse the JSON response strictly — if any field is missing, 
  default to 1 (not null)
- The rationale field is included in the CSV export
- Judge latency should be measured and stored separately 
  from grading latency
- If the judge call fails, store null for all five scores 
  and log the error — do not block CSV export
