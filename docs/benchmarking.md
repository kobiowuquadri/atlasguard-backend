# Benchmarking

## The Nigerian Context Benchmark (`nigerian-context-v1`, v1.0.0)

57 cases: 14 semantic groups × {Nigerian English, Yoruba, Hausa, Igbo} plus one standalone
instruction-following case.

| Category | Semantic groups | What is checked |
|---|---|---|
| Financial terminology | transfer total with fee (₦5,050); simple interest on savings (₦2,000) | numeric facts |
| Nigerian English | "go-slow" (traffic jam, not industrial action); "flash me" (missed call) | concept facts (reviewed by humans) |
| Education | classroom area (48 m²); boiling point of water (100 °C) | numeric facts |
| Civic information | capital (Abuja); number of states (36); independence year (1960) | entity / numeric facts, with constitutional references |
| Cultural & linguistic context | Yoruba morning greeting; "thank you" in Hausa; "thank you" in Igbo | entity facts |
| Translation & meaning | preserve price/name/place (₦75,000, Amina, Bodija); preserve dosage (2 tablets, 8 hours, 5 days) | numeric + entity facts |
| *(standalone)* | define POS as JSON | instruction rules (JSON keys, required term) |

**Review status: every case is `pending_review`.** Prompts, translations and reference facts
were drafted with AI assistance. They must be checked by fluent speakers before being marked
verified; until then results are indicative. Time-sensitive legal or regulatory claims were
deliberately avoided.

## Dataset format (formatVersion 1)

Defined by `BenchmarkDatasetSchema` in `packages/shared` and published as JSON Schema at
[`packages/benchmarks/schemas/benchmark-dataset.schema.json`](../packages/benchmarks/schemas/benchmark-dataset.schema.json).

```jsonc
{
  "formatVersion": 1,
  "suite": { "slug": "my-suite", "name": "My suite", "version": "1.0.0", "visibility": "private" },
  "semanticGroups": [
    {
      "key": "transfer-fee-total",
      "title": "Bank transfer total with fee",
      "category": "financial_terminology",
      "expectedFacts": [
        { "id": "total-deducted", "type": "numeric", "description": "Total is ₦5,050",
          "value": 5050, "unit": "NGN", "ignoreValues": [5000, 50] }
      ],
      "cases": [
        { "key": "transfer-fee-total.en-NG", "language": "en-NG", "title": "…", "prompt": "…",
          "difficulty": "easy", "evaluationRules": [],
          "provenance": { "sourceType": "synthetic", "translationSource": "original", "reviewStatus": "pending_review" } }
      ]
    }
  ],
  "cases": [ /* standalone cases carry their own "category" and "expectedFacts" */ ]
}
```

* **Facts** — `numeric` (`value`, `tolerance`, `unit`: `NGN`/`%`/`year`, `ignoreValues`,
  `acceptedPhrases` per language for numbers in words), `entity` (`accepted`,
  `acceptedByLanguage`, `conflicting`, `conflictingByLanguage`), `concept` (`evidence` and
  `contradictions` per language). Phrases are plain text; a single trailing `*` is a prefix.
  `required` defaults to true.
* **Rules** — `response_language` (override or `any`), `json_format`, `max_words`,
  `min_words`, `required_terms`, `forbidden_terms`, `forbidden_format`, `max_latency_ms`.
  `requiredTerms`/`forbiddenTerms` on a case are shorthands.
* **Provenance** — `sourceType` (`human`/`official`/`synthetic`), `translationSource`
  (`original`/`human_translation`/`machine_translation`/`ai_generated`), `translatedFrom`,
  `author`, `sourceReference`, `notes`, `reviewStatus` (`draft`/`pending_review`/`verified`).
  `verified` is rejected unless `reviewedBy` and `reviewedAt` are present.

Structural rules enforced by the validator: unique case keys, unique group keys, unique fact
ids, at most one variant per language per group, `factIds` must exist. Quality warnings (not
errors): concept facts without phrases for a case language, single-language groups.

## Workflow

1. Write or edit a dataset JSON (bump `suite.version` for any content change — imported
   suites are immutable so historical runs stay reproducible).
2. Validate: `pnpm benchmarks:validate path/to/file.json` (or *Benchmarks → Import → Validate*).
3. Import as a private suite (dashboard or `POST /benchmarks/import`). Administrators can
   import official suites.
4. Review: fluent reviewers open each case, check prompt, translation and facts, and mark it
   *Verified* (attestation required) or *Rejected* with notes. Official suites are reviewed
   by administrators; the reviewer and time are recorded in the case provenance.
5. Run evaluations; use *Only human-verified cases* to restrict a run to verified content.

## Adding a language

Not supported until all of the following exist and are tested: lexicon and orthographic
markers in `packages/evaluator/src/language/lexicon.ts`, negation cues, benchmark variants,
reviewed evidence phrases, and updated `SUPPORTED_LANGUAGES`.
