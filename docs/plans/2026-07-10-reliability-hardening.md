# Coze Debug Exporter Reliability Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for every behavior change.

**Goal:** Prevent lost captures, protect copied secrets, preserve loop iterations, bound cache growth, and restore regression coverage.

**Architecture:** Keep the existing Trace-first pipeline. Serialize background writes, attach batch executions to a single node as `iterations`, and enforce both record-count and approximate-size limits before writing Chrome local storage.

**Tech Stack:** Chrome Extension Manifest V3, plain JavaScript, Node.js built-in test runner.

### Task 1: Restore regression tests

**Files:**
- Create: `tests/core.test.js`
- Create: `tests/ui.test.js`
- Modify: `package.json`

1. Copy the previously validated v0.1.7 tests into this repository.
2. Point imports at the repository-root extension files.
3. Update UI assertions for the current card/modal markup.
4. Run `npm test`; existing-behavior tests must pass before new fixes begin.

### Task 2: Serialize captures and bound storage

**Files:**
- Create: `tests/background.test.js`
- Modify: `background.js`

1. Add a failing test that delivers two capture messages concurrently and expects both records to remain.
2. Add a failing test that supplies oversized records and expects old records to be trimmed.
3. Implement a promise queue around capture writes.
4. Implement count and approximate character-size limits.
5. Return storage statistics from `GET_RUNS`.

### Task 3: Expand redaction

**Files:**
- Modify: `tests/core.test.js`
- Modify: `core.js`

1. Add failing cases for `cookie`, `token`, `refresh_token`, `api_key`, and `session`.
2. Expand secret-key matching without changing ordinary fields.
3. Run all tests.

### Task 4: Preserve loop iterations

**Files:**
- Modify: `tests/core.test.js`
- Modify: `tests/ui.test.js`
- Modify: `core.js`
- Modify: `report.html`
- Modify: `report.js`
- Modify: `styles.css`

1. Add a failing grouping test with two `batch_index` values for the same node.
2. Store both records under one node's `iterations` list.
3. Add a failing UI test for a batch selector in the detail modal.
4. Render the selector and switch displayed input/output/error by iteration.

### Task 5: Reduce parsing work and repair UI regressions

**Files:**
- Modify: `tests/core.test.js`
- Modify: `tests/ui.test.js`
- Modify: `core.js`
- Modify: `report.js`
- Modify: `popup.js`

1. Add a failing test proving a request/response pair is parsed at most once each.
2. Reuse parsed bodies throughout normalization and replace queue `shift()` traversal with an index.
3. Add tests for distinct success/running/unknown badge classes.
4. Restore selection fallback when a previously selected run disappears.
5. Display approximate cache size.

### Task 6: Verify

1. Run `npm test`.
2. Run `npm run check`.
3. Confirm `git diff --check` succeeds.
4. Review the final diff for unrelated changes.
