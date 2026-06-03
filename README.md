# BioBridge MVP4 — Internal Testing Tool

## Overview
This is an internal prototype for testing three feedback generation methods for Keystone Biology constructed-response questions.

## Branch Structure
- `main` — stable base, contains shared UI and question data
- `method-1` — GradeOpt + RAG pipeline (Phase 1 offline training + Phase 2 real-time inference)
- `method-2` — 
- `method-3` — 
- `eval-dashboard` — evaluation harness: batch test cases, LLM judge scoring, and CSV export

### Eval Dashboard
1. Switch to branch `eval-dashboard`: `git checkout eval-dashboard`
2. Run `npm run dev`
3. Select a question and method
4. Load preset test cases or enter student responses manually
5. Click **Run Grading** — all parts are graded in one batch; a `run_id` ties the rows together
6. Optionally enable the **LLM Judge** to score each feedback string on five dimensions (task_focus, specificity, manageability, answer_leakage, overall_quality) — see `skills/Ref1-FeedbackRubric.md`
7. Click **Export CSV** to download results — see `skills/Ref2-CSVExport.md` for column definitions and pass thresholds

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

