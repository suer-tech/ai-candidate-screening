# Bounded assessment prompt projection — RED evidence

- Date: 2026-08-24
- Command: `npm run test:assessment-prompt:bounded`
- Result: expected RED — 1 test, 0 passed, 1 failed
- Machine evidence: `bounded-assessment-prompt-red.junit.xml`

`ASSESSMENT-PROMPT-001` constructs 87 synthetic facts with source quotes close to the observed production maximum and 30 verbose conflicts. The acceptance requires a deterministic provider projection that:

- preserves every fact ID, predicate, value, confidence and significant flag;
- preserves sufficient document/transcript source coordinates;
- keeps a useful quote capped at 240 characters;
- represents every conflict compactly without verbose explanation;
- serializes the complete projected evidence to at most 120 KB;
- is used only for the RouterAI user message, while response grounding continues against the original full evidence facts.

Actual failure: `projectAssessmentEvidenceForPrompt` is absent, and production currently places the complete `evidence` bundle directly into the provider user message. The existing `groundStructuredAssessment(..., evidence.facts ?? [])` original-evidence grounding boundary is retained by the oracle.

No production code was changed.
