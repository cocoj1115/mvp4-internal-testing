# BioBridge MVP4 — Internal Testing Tool

## Overview
This is an internal prototype for testing three feedback generation methods for Keystone Biology constructed-response questions.

## Branch Structure
- `main` — stable base, contains shared UI and question data
- `method-1` — GradeOpt + RAG pipeline (Phase 1 offline training + Phase 2 real-time inference)
- `method-2` — Two-Stage LLM Grading (Stage 1: score + failure type classification; Stage 2: targeted feedback)
- `method-3` — Error-aware feedback-first grading with Keystone boundary examples (forced order: error analysis → feedback → score → confidence)
- `eval-dashboard` — evaluation harness: batch test cases, LLM judge scoring, and CSV export

## How to Test a Method

### Method 1 (GradeOpt + RAG)
1. Switch to branch `method-1`: `git checkout method-1`
2. Run `npm run dev`
3. Select a question from the dropdown
4. Select Method 1
5. Upload the Keystone scoring PDF (KD1 + KD2 + KE can be in one file)
6. Review and confirm the extracted G0 (key concepts + rubrics)
7. Run GradeOpt training — watch the streaming log
8. Review and approve the generated Adaptation Rules (G*)
9. Answer Part A, B, C and observe scores + feedback
10. Try Attempt 2 to see gap resolution

### Eval Dashboard
1. Switch to branch `eval-dashboard`: `git checkout eval-dashboard`
2. Run `npm run dev`
3. Select a question and method
4. Load preset test cases or enter student responses manually
5. Click **Run Grading** — all parts are graded in one batch; a `run_id` ties the rows together
6. Optionally enable the **LLM Judge** to score each feedback string on five dimensions (task_focus, specificity, manageability, answer_leakage, overall_quality) — see `skills/Ref1-FeedbackRubric.md`
7. Click **Export CSV** to download results — see `skills/Ref2-CSVExport.md` for column definitions and pass thresholds

### Method 2 and 3
1. Switch to the relevant branch: `git checkout method-2` or `git checkout method-3`
2. Run `npm run dev`
3. Select a question and the method
4. Answer directly — no setup required
5. Observe scores + feedback

## How to Add a New Method
1. Create a new branch from main: `git checkout -b method-4`
2. In `app/api/grade/route.ts`, add a new case for `method === "4"`
3. Implement your scoring and feedback logic in `lib/methods/method4.ts`
4. In `app/page.tsx`, add Method 4 to the method selector
5. Test locally with `npm run dev`
6. Push the branch: `git push origin method-4`

## Environment Setup
1. Copy `.env.local.example` to `.env.local`
2. Add your OpenAI API key: `OPENAI_API_KEY=your_key_here`
3. Install dependencies: `npm install`
4. Run locally: `npm run dev`

## Questions Included
| ID | Standard | Topic |
|---|---|---|
| M1Q14 | 3.1.9-12.A | DNA and Protein Structure |
| M1Q15 | 3.1.9-12.C | Homeostasis and Feedback Mechanisms |
| M2Q14 | 3.1.9-12.P | Genetics and Heredity |
| M2Q15 | 3.1.9-12.N | Green Stormwater Infrastructure |

## Key Files
- `app/page.tsx` — main UI
- `app/api/grade/route.ts` — scoring and feedback API
- `app/api/parse/route.ts` — PDF parsing API
- `app/api/train/route.ts` — GradeOpt training API
- `app/api/eval-judge/route.ts` — LLM judge API (eval-dashboard branch)
- `lib/questions.ts` — hardcoded question data
- `lib/methods/` — method-specific logic
- `data/` — G* JSON files per standard
- `skills/Ref1-FeedbackRubric.md` — judge rubric and prompt spec (5 dimensions, 1–4 scale)
- `skills/Ref2-CSVExport.md` — CSV column definitions, pass thresholds, and formatting rules

## Notes
- No database. Session state lives in memory and resets on page refresh.
- G* files in `/data` are per standard, not per question.
- Method 2 uses two sequential LLM calls; `tokenCount` and `latencyMs` span both calls combined.
- Confidence flagging: responses with medium or low confidence are flagged in the results panel.
- LLM judge always runs at temperature 0 with `json_object` response format — never reuse the grading model config for it.
- CSV export is library-free (manual string building). See `skills/Ref2-CSVExport.md` for exact column order and pass thresholds before modifying.
- Judge failures store `null` for all five scores and are logged, but do not block CSV export.
