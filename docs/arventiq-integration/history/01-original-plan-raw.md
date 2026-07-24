Since **you don't want to change Arventiq at all initially**, then your coding platform should **pretend to be Judge0** from Arventiq's perspective.

That means **100% of the work happens in your Node backend**, and the Go judge remains almost unchanged.

# Phase 1 - Analyze Existing APIs

Before writing any code:

* Find all APIs exposed by your Node backend.
* Find all APIs exposed by your Go judge.
* Document the request/response formats.
* Identify where the Node backend forwards requests to RabbitMQ/Go judge.

---

# Phase 2 - Create an Adapter Layer

Don't modify your existing APIs.

Instead create a new module:

```text
/controllers
    judgeAdapter.ts
```

This module's only job is:

```text
Arventiq Request
        │
        ▼
judgeAdapter
        │
        ▼
Your Existing APIs
```

No business logic.

Only translation.

---

# Phase 3 - Support Arventiq's Payload

Since Arventiq already has a request format, your adapter should accept that format.

Example:

```text
Arventiq
{
    language,
    sourceCode,
    timeLimit,
    memoryLimit,
    testCases
}
```

↓

Convert to

```text
Judge Job
{
    language,
    code,
    limits,
    tests
}
```

↓

Queue

No changes to the judge.

---

# Phase 4 - Reuse Existing Submission Flow

Don't build a second submission system.

Reuse:

```
Node Backend
      │
RabbitMQ
      │
Go Judge
      │
Mongo
```

Only create the job in the format your workers already understand.

---

# Phase 5 - Translate the Response

The judge returns something like

```text
Accepted

Runtime

Memory

Passed

Failed
```

Your adapter converts it into whatever Arventiq currently expects.

Again—

the Go judge never knows Arventiq exists.

---

# Phase 6 - Authentication

Add a simple API key.

```
Authorization:

Bearer <ARVENTIQ_SECRET>
```

Validate it in middleware.

Done.

---

# Phase 7 - Keep Everything Backward Compatible

Don't remove anything.

You'll have:

```
Old APIs
```

for your own frontend.

and

```
Arventiq APIs
```

for Arventiq.

Both internally call the same service.

---

# Phase 8 - Future Refactor (Later)

Only after the integration is stable:

* Move shared execution logic into services.
* Remove duplicate code.
* Standardize payloads.
* Possibly migrate problem storage.

None of this is needed now.

---

# Folder Structure I'd Aim For

```text
Node Backend
│
├── controllers
│      ├── submissionController
│      └── arventiqController      ← NEW
│
├── adapters
│      └── arventiqAdapter         ← NEW
│
├── services
│      └── submissionService       ← Existing logic
│
├── queue
│
├── rabbitmq
│
└── workers
```

Go Judge:

```text
Go Judge
│
├── queue
├── executor
├── comparator
├── sandbox
└── languages
```

**No changes** unless Arventiq requires something your judge doesn't already support.

---

# Overall Plan

```text
          Phase 1
 Analyze existing APIs
          │
          ▼
          Phase 2
 Build Arventiq Adapter
          │
          ▼
          Phase 3
 Translate Arventiq payload
          │
          ▼
          Phase 4
 Reuse existing submission flow
          │
          ▼
          Phase 5
 Translate response back
          │
          ▼
          Phase 6
 Add authentication
          │
          ▼
          Phase 7
 End-to-end testing with Arventiq
```

## One thing I would do **before writing any code**

Since Arventiq currently talks to Judge0, I'd first **reverse-engineer exactly what requests it sends**.

Capture:

* Request URL
* Headers
* Request body
* Expected response

Then make your Node backend expose **compatible endpoints** (or an adapter that maps those requests to your existing services). That way, you can integrate with Arventiq with minimal or no changes on its side, while keeping your Go judge and existing architecture largely intact.
