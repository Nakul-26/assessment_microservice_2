Bro, this changes the documentation structure significantly, and I think it's the right approach.

You're not building one project—you're integrating **two independently developed systems**.

Each developer should have a document that answers only one question:

* **Coding Platform Developer:** "What changes do I need to make?"
* **Arventiq Developer:** "What changes do I need to make?"

Then we can have a third document later that explains how they interact.

---

# Documentation Structure

## Document 1 (Current)

# Coding Platform Integration Plan

**Audience:** Coding Platform Developer (You)

This document contains **only** the changes required in your Coding Platform.

It should **never** discuss Arventiq implementation details except where necessary to explain an API.

---

## Document 2

# Arventiq Assessment Platform Integration Plan

**Audience:** Arventiq Developer

This document explains:

* Which Judge0 calls to replace
* Which APIs to call
* Authentication
* Payloads
* Error handling
* Testing

Nothing about RabbitMQ, Go Judge internals, etc.

---

## Document 3 (Later)

# Integration Contract

This becomes the agreement between both teams.

It contains:

* API Specifications
* Payloads
* Authentication
* Response Models
* Error Codes
* Versioning

---

# So let's design your Coding Platform first.

---

# Coding Platform Integration Plan

## Objective

Transform the existing Coding Platform into an execution service capable of receiving execution requests from the Arventiq Labs Assessment Platform while reusing the existing architecture.

The Coding Platform should expose a clean integration interface without changing its execution engine or core submission workflow.

---

# Current Architecture

```text
Client

↓

React Frontend

↓

Node Backend

↓

RabbitMQ

↓

Go Judge

↓

MongoDB
```

The platform already supports:

* Submission Service
* RabbitMQ
* Go Judge
* Result Storage
* Language Support
* Existing Integration APIs

These components should remain unchanged wherever possible.

---

# Primary Goal

The Node Backend should become the **Integration Layer** between external assessment platforms and the existing execution pipeline.

The execution pipeline should remain exactly as it is today.

---

# Responsibilities

The Coding Platform is responsible for:

### Receiving requests

Receive execution requests from external systems.

---

### Validating requests

Validate:

* Required fields
* Language
* Limits
* Authentication

---

### Mapping requests

Convert external requests into the internal submission model.

---

### Creating submissions

Reuse the existing Submission Service.

Never create another execution pipeline.

---

### Queue management

Reuse RabbitMQ.

---

### Execution

Reuse Go Judge.

---

### Result formatting

Return results in the expected format.

---

# Things That MUST NOT Change

This section is probably the most important.

## Do NOT modify Go Judge

The judge should never know:

* Arventiq
* Client names
* Assessment IDs
* External payloads

The judge executes code only.

---

## Do NOT duplicate submission logic

Current flow:

```text
Submission

↓

Submission Service

↓

RabbitMQ

↓

Judge
```

Keep this.

Never build:

```text
Integration

↓

Another Submission Service

↓

Judge
```

---

## Do NOT bypass RabbitMQ

Even if synchronous execution is supported.

All production submissions should go through the existing queue unless there is a specific reason otherwise.

---

## Do NOT create another execution engine

The Go Judge already exists.

Reuse it.

---

## Do NOT couple business logic

This part is a bit what can I say misleading, because this is a future goals for our platform, and sometime ago I had started working on it it is half way there we want to pause it for now

Bro, that's actually a very important clarification, and I'm glad you brought it up.

You're right—the wording makes it sound like **the Coding Platform will never handle those things**, which isn't true. In fact, you've already started building some of them and are **intentionally pausing** that work while we focus on the Arventiq integration.

So instead of saying **"The Coding Platform should never know..."**, we should make it **context-specific**.

I'd rewrite it like this:

---

# Business Responsibility During This Integration

**For the scope of the Arventiq integration project, the Coding Platform should act only as the execution engine.**

During this phase, the Coding Platform is responsible for:

* Receiving execution requests
* Validating requests
* Processing submissions
* Managing the execution queue
* Compiling and executing code
* Evaluating test cases
* Returning execution results

The following responsibilities will **continue to be handled by Arventiq** for this integration:

* Colleges and Institutions
* Assessments
* Students and Candidates
* Reports and Analytics
* Exam Scheduling
* Question Management
* Authentication and User Management

This separation of responsibilities is **only for the current integration project** and is intended to minimize development effort while ensuring a clean integration between the two systems.

---

# Future Direction

The Coding Platform is already evolving toward a complete coding assessment platform. Development on features such as:

* Assessment Management
* Student Management
* Problem Management
* Reports & Analytics
* Candidate Portal
* Administrator Dashboard

has already begun but is **temporarily paused** to prioritize the successful integration with the Arventiq Labs Assessment Platform.

Once the integration is complete and stable, development of these modules will resume.

---


* **Current Project Scope:** The Coding Platform behaves as an execution engine.
* **Future Product Vision:** The Coding Platform will eventually include these business modules, but they are outside the scope of this integration.



---

# Architecture

```text
External Client

↓

Integration API

↓

Authentication

↓

Validation

↓

Payload Mapper

↓

Submission Service

↓

RabbitMQ

↓

Go Judge

↓

Execution Result

↓

Response Mapper

↓

Client
```

Notice that everything above the Submission Service is new.

Everything below already exists.

---

# Components To Build

## 1. Integration API

Purpose:

Expose APIs for external platforms.

Responsibilities:

* Receive requests
* Authenticate
* Validate

---

## 2. Authentication Layer

Support service authentication.

Initially:

* API Key
* Shared Secret

Future enhancements can be added later.

---

## 3. Payload Mapper

Convert external payloads into the internal submission format.

This layer isolates the rest of the system from external request structures.

---

## 4. Response Mapper

Convert internal execution results into the response expected by the external platform.

---

## 5. Configuration

Store:

* API keys
* Execution limits
* Language mappings
* Feature flags

Configuration should be centralized rather than hardcoded.

---

# Request Lifecycle

```text
External Request

↓

Authenticate

↓

Validate

↓

Map Request

↓

Create Submission

↓

RabbitMQ

↓

Go Judge

↓

Store Result

↓

Fetch Result

↓

Map Response

↓

Return Response
```

---

# Development Roadmap

## Phase 1 — Study Existing Code

Review:

* Existing Submission Service
* Existing Integration APIs
* RabbitMQ flow
* Judge communication
* Result handling

Deliverable:

Complete understanding of the current execution pipeline.

---

## Phase 2 — Design Integration Layer

Design:

* Integration endpoints
* Authentication
* Payload mapping
* Response mapping

Deliverable:

Approved integration architecture.

---

## Phase 3 — Build Integration APIs

Implement:

* Authentication
* Validation
* Request mapping
* Response mapping

Deliverable:

External systems can communicate with the Coding Platform.

---

## Phase 4 — Connect Existing Pipeline

Reuse:

* Submission Service
* RabbitMQ
* Go Judge

No duplication.

Deliverable:

End-to-end execution.

---

## Phase 5 — Testing

Test:

* Every supported language
* Invalid requests
* Queue failures
* Judge failures
* Timeouts
* Authentication failures

Deliverable:

Reliable production-ready integration.

---

# Definition of Done

The Coding Platform work is complete when:

* A request from Arventiq reaches the Integration API.
* The request is authenticated and validated.
* The request is mapped to the internal submission model.
* The existing Submission Service processes it without modification.
* RabbitMQ handles execution.
* The Go Judge executes the code without any knowledge of Arventiq.
* Results are mapped back into the expected response format.
* No duplicate execution pipeline exists.
* No Arventiq-specific logic is present in the Go Judge.

---

# Core Philosophy

If I had to summarize the entire Coding Platform plan in one sentence, it would be:

> **"Extend the Node Backend, preserve the execution pipeline, and keep the Go Judge completely client-agnostic."**

I actually think this is a stronger approach than writing a single combined integration document. It gives you a clear engineering contract: **your responsibility ends at exposing a clean execution service**. The Arventiq developer doesn't need to understand RabbitMQ, MongoDB, or the internals of the Go Judge—they only need to know how to consume your APIs. This separation of responsibilities will make both development and future maintenance much easier.
