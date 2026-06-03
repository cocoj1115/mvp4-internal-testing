# CSV Export
Use this whenever writing any code that generates,
formats, or downloads a CSV file in the BioBridge evaluation
dashboard. This includes: export button handlers, CSV 
formatting functions, and column definition arrays.

Read this file completely before writing any CSV-related code.

---

## File Naming Convention

```
KB Tuttor_eval_{YYYY-MM-DD}_{partLabel}.csv
```

Examples:
- `KB Tutor_eval_2026-06-03_A.csv`
- `KB Tutor_eval_2026-06-03_all.csv` (when all parts exported together)

---

## Column Definitions

Columns must appear in this exact order in the CSV.

### Input Columns
| Column Name | Type | Description |
|---|---|---|
| `run_id` | string | UUID generated per run, same across all rows in one "Run Grading" click |
| `timestamp` | ISO string | When the grading run completed |
| `question_id` | string | Always "M1Q14" in MVP |
| `part` | string | "A", "B", or "C" |
| `test_case_id` | string | ID from test case library, or "custom" if manually entered |
| `student_response` | string | The student response that was graded |
| `official_score` | number or "" | Official Keystone score if using preset test case, empty if custom |

### Model Configuration Columns
| Column Name | Type | Description |
|---|---|---|
| `model` | string | Full model string (e.g. "gpt-5.4", "claude-sonnet-4-6") |
| `provider` | string | "openai", "anthropic", or "google" |
| `temperature` | number | 0, 0.5, or 1.0 |
| `method` | number | 1, 2, or 3 |

### Grading Output Columns
| Column Name | Type | Description |
|---|---|---|
| `ai_score` | number | Score returned by grading API (0 or 1) |
| `score_match` | boolean | true if ai_score === official_score, "" if no official score |
| `feedback` | string | Feedback text returned by grading API |
| `grading_latency_ms` | number | Time from submission to grading response in milliseconds |
| `grading_token_count` | number | Total tokens used by grading call |

### LLM Judge Columns
| Column Name | Type | Description |
|---|---|---|
| `judge_run` | boolean | Whether judge was run on this row |
| `task_focus` | number or "" | Judge score 1–4, empty if judge not run |
| `specificity` | number or "" | Judge score 1–4, empty if judge not run |
| `manageability` | number or "" | Judge score 1–4, empty if judge not run |
| `answer_leakage` | number or "" | Judge score 1–4, empty if judge not run |
| `overall_quality` | number or "" | Judge score 1–4, empty if judge not run |
| `judge_rationale` | string or "" | One-sentence rationale from judge, empty if judge not run |
| `judge_latency_ms` | number or "" | Time for judge call in milliseconds, empty if judge not run |

### Pass/Fail Columns
| Column Name | Type | Description |
|---|---|---|
| `pass_task_focus` | boolean or "" | true if task_focus ≥ 3.5 |
| `pass_specificity` | boolean or "" | true if specificity ≥ 3.0 |
| `pass_manageability` | boolean or "" | true if manageability ≥ 3.0 |
| `pass_answer_leakage` | boolean or "" | true if answer_leakage ≥ 3.0 |
| `pass_overall` | boolean or "" | true if ALL four above are true |

---

## Pass Thresholds

| Metric | Threshold |
|---|---|
| task_focus | ≥ 3.5 |
| specificity | ≥ 3.0 |
| manageability | ≥ 3.0 |
| answer_leakage | ≥ 3.0 |
| overall_quality | informational only, no pass threshold |

---

## Formatting Rules

- Delimiter: comma
- Encoding: UTF-8 with BOM (for Excel compatibility)
- String quoting: wrap all string fields in double quotes
- Escape internal double quotes by doubling them ("")
- Boolean values: export as "true" / "false" (lowercase strings)
- Empty values: empty string "" — never "null", never "undefined"
- Numbers: no trailing zeros (0.5 not 0.50)
- Line endings: CRLF for Windows compatibility

---

## Implementation Notes for Claude Code

- Use a library-free approach — build the CSV string manually
  using Array.join() for rows and columns
- The export function receives an array of result objects
  and returns a Blob for download
- Trigger download via a temporary anchor element — 
  do not use any CSV library unless explicitly told to
- All columns must be present in every row even if empty
- Column order must match the order defined in this skill exactly
- The run_id ties together all rows from one "Run Grading" click
  so researchers can filter by run in Excel
