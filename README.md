# BioBridge MVP4 — Internal Testing Tool

## Overview
This is an internal prototype for testing three feedback generation methods for Keystone Biology constructed-response questions.

## Branch Structure
- `main` — stable base, contains shared UI and question data
- `method-1` — GradeOpt + RAG pipeline (Phase 1 offline training + Phase 2 real-time inference)
- `method-2` — Two-Stage LLM Grading (Stage 1: score + failure type classification; Stage 2: targeted feedback)
- `method-3` — Error-aware feedback-first grading with Keystone boundary examples (forced order: error analysis → feedback → score → confidence)
- `eval-dashboard` — evaluation harness: batch test cases, LLM judge scoring, and CSV export

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
