# Scope agent findings to the diff

**Date:** 2025-03-06
**PR:** https://github.com/llimllib/pr-review/pull/4
**Branch:** focus

## Problem

The pr-review tool was frequently reporting issues unrelated to the PR at hand — for example, finding unused imports in files that weren't touched in the diff and reporting them as review findings.

The root cause was that all four sub-agents had read-only access to the full codebase and were encouraged to "USE YOUR TOOLS aggressively" without any constraint on what they should report. When they explored surrounding files for context, they'd find pre-existing issues and include them in their reports.

## Changes

Updated all agent system prompts in `src/agents.ts` to add explicit scoping:

- **Bug Hunter, Test Reviewer, Code Quality**: Added a `SCOPE:` section stating that only issues in code ADDED or MODIFIED in the diff should be reported. Tools are for understanding context, not auditing the codebase.
- **Impact Analyzer**: Gets a nuanced version — looking beyond the diff is appropriate for tracing effects of changes, but every finding must trace back to a specific change in the diff.
- **Summarizer**: Added an `IMPORTANT FILTER:` instruction to discard any sub-agent findings about pre-existing issues in unchanged code. Acts as a second gate.

Also toned down "USE YOUR TOOLS aggressively" to more measured language about using tools for context.
