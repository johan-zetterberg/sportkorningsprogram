---
name: delegate
description: Orchestrator–workers routine for this repo — split a request into tasks, pick the cheapest model that can do each (scout/haiku, worker/sonnet, or the main model), run them, then verify the result before reporting. Use for multi-part work to save usage.
---

# Delegate and verify

Goal: do the work with the cheapest capable model, and keep the expensive model for planning, hard parts and verification.

## 1. Plan (main model)
- Restate the request as a list of concrete tasks with acceptance checks.
- For each task decide the level:
  - **scout** (haiku, read-only): finding code, listing call sites, collecting facts.
  - **worker** (sonnet): bounded changes with clear specs — UI, texts/i18n, small fixes, tests for known behaviour, mechanical refactors.
  - **main model** (do it yourself or a general-purpose agent without a model override): rule interpretation (TR/FEI), result-engine logic, data-model changes across files, Firestore/Storage rules design, security/privacy, concurrency/offline behaviour, anything ambiguous.
- When in doubt between two levels, pick the cheaper one only if a wrong result would be caught by the checks.

## 2. Delegate
- Give each agent: the exact task, the files it owns (and files it must not touch when others run in parallel), the acceptance checks to run, and the report format.
- Run independent tasks in parallel, but at most two heavy agents at a time (usage limits).
- Scouts first when the plan needs facts; feed their findings into the worker prompts instead of letting workers rediscover them.

## 3. Verify (main model, always)
- Read the worker's report critically; check the diff of the files it touched (`git diff --stat`, then the risky hunks).
- Run the checks yourself on the combined tree: `npm test`, `npm --prefix functions run lint`, `node scripts/audit_i18n.cjs`, `npm run check:sw-cache`, and when relevant `npm run test:rules`, `npm run test:storage-rules`, `npm run test:restore`, `npm run test:smoke`.
- If a result is wrong or incomplete: send it back to the same agent with the specific problem (SendMessage), or escalate that part to the main model.
- Only then commit locally and report to the user (in Swedish), stating what was verified and how.

## Notes
- Deploy and push only when the user asks (see memory: deploy needs --force, ask first).
- A worker's "tests pass" is not verification; your own run on the combined tree is.
