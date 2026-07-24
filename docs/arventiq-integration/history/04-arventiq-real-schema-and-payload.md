 Here are the Database Schema for coding problems and a Real Coding Problem Payload extracted directly from arventiq coding platform (supabase_schema.sql and judge.js).
  ──────
  ### 1. Database Schema for Coding Problems
  In this exam portal, coding problems and test cases are stored across questions, test_cases, question_subtasks, and code_submissions.
    -- ── 1. QUESTIONS TABLE (Coding Problem Definition) ──
    CREATE TABLE IF NOT EXISTS questions (
      id                  SERIAL PRIMARY KEY,
      exam_id             INTEGER NOT NULL REFERENCES exams(id),
      section_id          INTEGER REFERENCES exam_sections(id),
      question_type       TEXT NOT NULL DEFAULT 'coding', -- 'coding' | 'mcq' | etc.
      question_text       TEXT NOT NULL,                  -- Problem Statement (Markdown / HTML)
      marks               INTEGER NOT NULL DEFAULT 10,
      negative_marks      REAL DEFAULT 0,
      code_snippet        TEXT,                           -- Starter / Boilerplate code template
      code_language       TEXT,                           -- Default language (e.g. 'python', 'cpp', 'java')
      
      -- Judge & Resource Limits
      time_limit_ms       INTEGER NOT NULL DEFAULT 2000,  -- Time limit in milliseconds
      memory_limit_kb     INTEGER NOT NULL DEFAULT 262144,-- Memory limit (256 MB)
      output_limit_kb     INTEGER NOT NULL DEFAULT 4096,  -- Max stdout cap (4 MB)
      float_tolerance     REAL,                           -- E.g. 1e-6 for floating point matching
      checker_language    TEXT,                           -- Custom checker / Special judge language
      checker_code        TEXT,                           -- Custom checker source code
      
      -- Output Comparison & Formatting Rules
      normalize_whitespace INTEGER DEFAULT 0,
      normalize_newlines   INTEGER DEFAULT 0,
      case_insensitive     INTEGER DEFAULT 0,
      ignore_blank_lines   INTEGER DEFAULT 0,
      input_format         TEXT,                          -- Description of input format
      output_format        TEXT,                          -- Description of output format
      deleted_at           TIMESTAMPTZ,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    
    -- ── 2. TEST CASES TABLE ──
    CREATE TABLE IF NOT EXISTS test_cases (
      id              SERIAL PRIMARY KEY,
      question_id     INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      input           TEXT NOT NULL DEFAULT '',           -- Standard input (stdin)
      expected_output TEXT NOT NULL,                      -- Standard expected output (stdout)
      is_hidden       INTEGER NOT NULL DEFAULT 0,         -- 0 = Sample / Visible, 1 = Hidden
      visibility      TEXT DEFAULT 'visible',             -- 'visible' | 'hidden' | 'sample'
      points          INTEGER NOT NULL DEFAULT 1,         -- Weighted score per test case
      weight          REAL DEFAULT 1.0,
      description     TEXT,                               -- Test case description / hint
      sort_order      INTEGER NOT NULL DEFAULT 0,
      test_group      TEXT,                               -- Subtask group label (e.g., 'subtask_1')
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    
    -- ── 3. QUESTION SUBTASKS TABLE (Grouped Scoring) ──
    CREATE TABLE IF NOT EXISTS question_subtasks (
      id             SERIAL PRIMARY KEY,
      question_id    INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      group_ids_json JSONB NOT NULL,                     -- e.g. ["subtask_1", "subtask_2"]
      points         INTEGER NOT NULL DEFAULT 0,
      sort_order     INTEGER NOT NULL DEFAULT 0,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    
    -- ── 4. CODE SUBMISSIONS TABLE (Authoritative Judge Verdict & Runs) ──
    CREATE TABLE IF NOT EXISTS code_submissions (
      id                SERIAL PRIMARY KEY,
      attempt_id        INTEGER NOT NULL REFERENCES attempts(id),
      question_id       INTEGER NOT NULL REFERENCES questions(id),
      language          TEXT NOT NULL,                    -- e.g. 'python', 'cpp', 'javascript', 'java'
      code              TEXT NOT NULL,                    -- Student code payload
      status            TEXT DEFAULT 'submitted',         -- 'draft' | 'submitted' | 'queued'
      verdict           TEXT,                             -- 'accepted' | 'wrong_answer' | 'time_limit_exceeded' | etc.
      score             REAL DEFAULT 0,                   -- 0.0 to 1.0 fraction of score passed
      passed_count      INTEGER DEFAULT 0,
      total_count       INTEGER DEFAULT 0,
      max_time_ms       INTEGER DEFAULT 0,
      max_memory_kb     INTEGER DEFAULT 0,
      test_results_json JSONB,                            -- Detailed test execution result details
      judge_run_id      TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(attempt_id, question_id)
    );
    ──────
  ### 2. Real Coding Problem JSON Payload

  Below is an actual JSON payload structure used by the admin worker to create/store a coding problem (e.g. "Target Sum Pairs"):

    {
      "id": 1042,
      "exam_id": 45,
      "section_id": 3,
      "question_type": "coding",
      "question_text": "### Two Sum Problem\n\nGiven an array of integers `nums` and an integer `target`, return the 0-based indices of the two numbers such that
  they add up to `target`.\n\nYou may assume that each input would have **exactly one solution**, and you may not use the same element twice.\n\nPrint the space-
  separated indices in ascending order.",
      "marks": 20,
      "negative_marks": 0,
      "code_language": "python",
      "code_snippet": "import sys\n\ndef solve():\n    lines = sys.stdin.read().split()\n    if not lines: return\n    n = int(lines[0])\n    target =
  int(lines[1])\n    nums = [int(x) for x in lines[2:2+n]]\n    \n    # Your logic here\n    pass\n\nif __name__ == '__main__':\n    solve()",
      "time_limit_ms": 2000,
      "memory_limit_kb": 262144,
      "output_limit_kb": 4096,
      "normalize_whitespace": 1,
      "normalize_newlines": 1,
      "case_insensitive": 0,
      "input_format": "Line 1: N (number of elements) and Target\nLine 2: N space-separated integers",
      "output_format": "Space-separated pair of indices (e.g., '0 1')",
      "test_cases": [
        {
          "id": 5001,
          "input": "4 9\n2 7 11 15",
          "expected_output": "0 1",
          "is_hidden": 0,
          "visibility": "sample",
          "points": 5,
          "description": "Sample test case: 2 + 7 = 9"
        },
        {
          "id": 5002,
          "input": "3 6\n3 2 4",
          "expected_output": "1 2",
          "is_hidden": 0,
          "visibility": "sample",
          "points": 5,
          "description": "Sample test case: 2 + 4 = 6"
        },
        {
          "id": 5003,
          "input": "10000 19999\n...",
          "expected_output": "9998 9999",
          "is_hidden": 1,
          "visibility": "hidden",
          "points": 10,
          "description": "Hidden performance test case (N=10,000)"
        }
      ]
    }
    ──────
  ### 3. Real Server Judge Execution Response Payload

  When a student submits code, judge.js evaluates it and produces this detailed result report:

    {
      "verdict": "accepted",
      "score": 1.0,
      "max_time_ms": 142,
      "max_memory_kb": 32840,
      "compile_output": null,
      "passed_count": 3,
      "total_count": 3,
      "cases": [
        {
          "index": 1,
          "verdict": "accepted",
          "time_ms": 45,
          "memory_kb": 28400,
          "weight": 1.0,
          "passed": true,
          "group": null,
          "input": "4 9\n2 7 11 15",
          "expected": "0 1",
          "actual": "0 1",
          "stderr": ""
        },
        {
          "index": 2,
          "verdict": "accepted",
          "time_ms": 42,
          "memory_kb": 28600,
          "weight": 1.0,
          "passed": true,
          "group": null,
          "input": "3 6\n3 2 4",
          "expected": "1 2",
          "actual": "1 2",
          "stderr": ""
        },
        {
          "index": 3,
          "verdict": "accepted",
          "time_ms": 142,
          "memory_kb": 32840,
          "weight": 2.0,
          "passed": true,
          "group": null,
          "input": "[HIDDEN]",
          "expected": "[HIDDEN]",
          "actual": "[HIDDEN]",
          "stderr": ""
        }
      ]
    }

and This is exactly what we needed. It answers the biggest unknown.

## The conclusion

**Arventiq is NOT function-based.**

It is a **classic stdin/stdout judge system**, just like Judge0.

Evidence from the payload:

```json
{
  "code_snippet": "def solve(): ...",
  "input_format": "...",
  "output_format": "...",
  "test_cases": [
    {
      "input": "...",
      "expected_output": "..."
    }
  ]
}
```

Notice what's **missing**:

* ❌ `functionName`
* ❌ `parameters`
* ❌ `returnType`

Instead it has:

* ✅ stdin
* ✅ expected stdout

---

## Your Go Judge expects this

```json
{
  "functionName": "twoSum",
  "parameters": [
    {
      "name": "nums",
      "type": "int[]"
    },
    {
      "name": "target",
      "type": "int"
    }
  ],
  "returnType": "int[]"
}
```

The wrapper generator then creates something like:

```cpp
Solution sol;
auto ans = sol.twoSum(nums, target);
```

There is **no way** to generate this from:

```text
stdin:
4 9
2 7 11 15
```

because stdin contains **data**, not the API (function signature) your judge needs.

---

# Therefore Problem Sync does NOT solve the problem.

Earlier we thought:

```text
Arventiq Problem
        │
        ▼
Sync
        │
        ▼
Mongo Problem
```

Now we know that's impossible.

Because after syncing you'd still have:

```text
Problem

statement

stdin

stdout
```

instead of

```text
Problem

functionName
parameters
returnType
```

The required metadata simply doesn't exist.

---

# This means there are only two real architectural paths.

## Option 1 — Change Arventiq (Recommended if feasible)

Arventiq's problem authoring becomes function-based.

Example:

Instead of only storing:

```text
Problem Statement

Input Format

Output Format
```

it also stores:

```text
Function Name

Parameter Types

Return Type
```

Then your existing judge works unchanged.

---

## Option 2 — Change the Coding Platform

Teach the Go Judge to execute stdin/stdout programs.

Example flow:

```text
Compile

↓

Run executable

↓

Pipe stdin

↓

Capture stdout

↓

Compare expected_output
```

That is effectively a second execution mode.

Not necessarily a second pipeline, but definitely a second judging strategy.

---

# There's a third option (which I think is unrealistic)

Try converting stdin problems into function problems.

Example:

```
Input

4 9
2 7 11 15
```

↓

Automatically infer

```cpp
twoSum(vector<int>, int)
```

↓

Generate wrapper.

This is basically impossible to do reliably because the input format doesn't tell you:

* function name
* parameter names
* parameter grouping
* return type
* output type

You'd be trying to infer semantics from prose.

---

# So our integration plan changes significantly.

Previously the blocker was:

> "How do we synchronize problems?"

Now the blocker is:

> **"Can Arventiq represent function-based problems?"**

If the answer is **no**, then **Problem Sync is not enough**.

---

# My recommendation

I would pause the architecture document and have one discussion with the Arventiq developer:

> **Are you willing to change the problem model from stdin/stdout to function-signature based?**

That single answer determines the direction of the project.

* **If yes:** Keep your current Go Judge, implement Problem Sync, and proceed.
* **If no:** Your Coding Platform will need to support a stdin/stdout execution mode (or an equivalent adaptation), because the two problem models are fundamentally different.

This payload was the missing piece. It shows that the issue isn't where problems are stored—it's that **the two systems define a coding problem in fundamentally different ways**.


what I am thinking is going with option B because in the future the other platforms might be using the same problem schema - and we can't ask them to update their platform right?

I actually think you're looking at this from the **product perspective**, not just the Arventiq integration—and that's exactly the right mindset.

However, I'd refine Option B a little.

---

## Think about your long-term product

Suppose in the future you integrate with:

* Arventiq
* Moodle
* HackerRank Enterprise
* A custom college ERP
* Another assessment platform

Will they all have this?

```text
functionName
parameters
returnType
```

Probably not.

Most assessment platforms today are based on:

```text
Problem Statement

↓

stdin

↓

stdout

↓

Test Cases
```

because that's the competitive programming model.

If your platform only supports function-based problems, every integration will require the client to redesign their product.

That's a huge adoption barrier.

---

## So I wouldn't call it "Option B."

I'd call it **Multi-Model Problem Support**.

Your platform should support two problem models:

```text
                Coding Platform

                     │
        ┌────────────┴────────────┐
        │                         │
        ▼                         ▼
Function Problems          Stdin Problems
(LeetCode)                 (Judge0/Codeforces)
```

The rest of the pipeline remains the same.

```text
Submission

↓

RabbitMQ

↓

Go Judge

↓

Results
```

---

## The important distinction

You **don't** want two pipelines.

You want **one pipeline** with two execution strategies.

Something like:

```text
Submission

↓

Problem Type?

        │
   ┌────┴────┐
   │         │
   ▼         ▼
Function   Stdin
Runner     Runner

        │
        ▼
Verdict
```

Notice:

* Same Submission Service ✅
* Same Queue ✅
* Same Judge Service ✅
* Same Results ✅

Only the execution strategy changes.

---

## This is actually a stronger product

Instead of saying:

> "Our platform only supports LeetCode-style questions."

You can say:

> "Our platform supports both LeetCode-style and Judge0/competitive-programming style assessments."

That's a much broader market.

---

## One thing I would **not** do

I would **not** make stdin execution "just for Arventiq."

Instead, I'd design it like this:

```go
type ProblemType string

const (
    FunctionProblem ProblemType = "function"
    StdinProblem    ProblemType = "stdin"
)
```

Then every new integration simply specifies the problem type.

---

## My recommendation

I think your future roadmap should become:

**Phase 1**

* Support `function` problems (already exists).

**Phase 2**

* Add `stdin` problem support as a **first-class feature** of the Coding Platform, not as an Arventiq-specific workaround.

Then the integration becomes very simple:

```text
Arventiq

↓

Submission Translator

↓

ProblemType = STDIN

↓

Existing Pipeline

↓

Go Judge (stdin strategy)

↓

Result
```

And if another platform later comes along with the same schema, **you won't need to change anything**.

---

### One architectural change I'd make

Instead of saying:

> "Go Judge should not change."

I'd revise that principle slightly:

> **"The Go Judge should remain client-agnostic, but it may evolve to support multiple execution strategies (e.g., function-based and stdin-based) as first-class capabilities of the Coding Platform."**

That's an important distinction. You're **not changing the judge because of Arventiq**—you're enhancing the judge because your product is evolving to support multiple widely used coding assessment models. That makes the change part of your platform's roadmap rather than an integration-specific compromise.
