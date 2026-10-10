# Evaluation methodology

This document explains exactly how AtlasGuard turns a model response into a verdict, how
scores are aggregated, and where automated evaluation stops and human review begins. The
implementation lives in [`packages/evaluator`](../packages/evaluator) (evaluator version
**1.0.0**; every stored result records the version that produced it).

## 1. What is evaluated

A **benchmark case** is one prompt in one language, plus the reference facts and rules it
is judged against. Cases that ask the same question in several languages belong to a
**semantic group**; the group owns the language-independent reference facts that every
variant must preserve.

For each case in a run AtlasGuard:

1. sends the prompt (and, by default, the system prompt recommended on the N-ATLaS model
   card) to the configured model with the run's generation parameters;
2. records the exact response, the round-trip latency, the provider-reported generation
   time and token usage, the served model name and request ids;
3. runs the checks below and stores every check result with its method and evidence;
4. derives a verdict for the case;
5. when the run finishes, compares the fact-check outcomes of every semantic group across
   languages (cross-language consistency).

The case definition (facts, rules, terms, revision, review status) is **snapshotted** onto
each result, so a historical result can always be re-examined against exactly what it was
evaluated on.

## 2. Verdicts

| Verdict | Meaning |
|---|---|
| `PASSED` | Every applicable check passed under its documented method. |
| `FAILED` | At least one deterministic check failed (e.g. a wrong number, the wrong language with high confidence, invalid JSON when JSON was required). |
| `NEEDS_REVIEW` | No check failed, but at least one could not be decided automatically. |
| `ERROR` | A technical failure — the endpoint timed out, rejected credentials, returned malformed output, or reported a different model. **Never counted as a model failure.** |
| `SKIPPED` | The case did not run (the run was cancelled or stopped). |

Precedence: a determinate failure wins over review items; unknown outcomes are never turned
into passes. A reviewer can override `PASSED`, `FAILED` or `NEEDS_REVIEW` with a recorded
human decision (reviewer, time, notes, previous verdict). `ERROR` and `SKIPPED` cannot be
reviewed because there is no response to judge.

## 3. Checks

### A. Response validity — `response-validity/v1`
Fails if the response is empty after removing special tokens (`<|eot_id|>` …) or if the
endpoint reports a model other than the configured one. The provider layer already refuses
mismatched models (`PROVIDER_MODEL_MISMATCH`, recorded as `ERROR`), so N-ATLaS is never
silently substituted. A response cut off at the token limit passes validity but is flagged
`truncated` in the check details.

### B. Language compliance — `lexicon-orthography/v1`
A transparent heuristic, not a trained classifier:

* weighted function-word lexicons for English, Yoruba, Hausa, Igbo and Nigerian Pidgin
  ("strong" words are distinctive, "weak" words are shared between languages);
* orthographic markers on the original text: ẹ, ṣ (Yoruba), ị, ụ, ṅ (Igbo), ɗ, ƙ, ɓ, ƴ
  (Hausa), ọ (Yoruba/Igbo) and tone marks;
* text is folded (lower-case, tone marks and sub-dots removed, ɗ→d …) before lexicon
  matching, because model output often omits diacritics.

The result records the detected language, every language's share of the evidence, the
words and markers that contributed, the word count, a code-switching flag, and a heuristic
confidence `share × coverage factor × length factor` (not a calibrated probability).

Decision rules:

| Situation | Outcome |
|---|---|
| fewer than 3 words | `uncertain` (too short to identify) |
| expected language detected, confidence ≥ 0.45 | `pass` (code-switching noted) |
| expected language detected, weak evidence | `uncertain` |
| Nigerian Pidgin detected for a Nigerian English case | `uncertain` (a reviewer decides) |
| expected language holds ≥ 25 % of the evidence alongside another (code-switching) | `uncertain`, or `fail` only if the case forbids code-switching |
| another language detected with confidence ≥ 0.55 | `fail` |
| anything else | `uncertain` |

Code-switched answers are therefore never failed automatically.

### C. Factual accuracy — reference facts
Facts are defined per semantic group (or per standalone case) in one of three types. Phrases
are plain text (never regular expressions), matched as whole words after folding; a trailing
`*` makes the last word a prefix.

**Numeric facts — `numeric-extraction/v1`** (language-independent). Numbers are extracted
from digits with Nigerian conventions (`₦5,050.00`, `N5,000`, `#300`, `5k`, `2 million`,
`15%`). Values restated from the prompt are listed in `ignoreValues`; a `unit` of `NGN`, `%`
or `year` narrows candidates to currency amounts, percentages or years.

| Response contains | Status | Effect |
|---|---|---|
| the expected value (± tolerance), or a reviewed word form of it | `supported` | pass |
| exactly one other candidate value | `contradicted` | **fail** |
| several other candidate values | `uncertain` | review |
| no candidate digits | `not_found` | review — the number may be written in words |

**Entity facts — `entity-match/v1`.** Reviewed accepted forms (e.g. *Abuja*, *Àbújá*) and
known conflicting entities (e.g. *Lagos*, *Èkó*).

| Response mentions | Status | Effect |
|---|---|---|
| an accepted form only | `supported` | pass |
| a conflicting entity only | `contradicted` | **fail** |
| both | `uncertain` | review (it may be contrasting them) |
| neither | `not_found` | **fail** if the fact is required |

**Concept facts — `concept-lexical/v1`.** Reviewed evidence phrases per language, optional
contradiction phrases, and negation detection (a negation cue in the three preceding words,
or the Igbo *-ghị* negative suffix). Because lexical matching cannot establish meaning,
**concept facts never fail automatically**:

| Response contains | Status | Effect |
|---|---|---|
| an evidence phrase, not negated | `supported` | pass |
| an evidence phrase near a negation, or both evidence and contradiction | `uncertain` | review |
| only a contradiction phrase | `contradicted` (lexical) | review |
| nothing / no phrases defined for the language | `not_found` / `uncertain` | review |

Optional facts (`required: false`) that are missing do not affect the verdict.

### D. Instruction compliance — `instruction-rules/v1`
Deterministic pass/fail rules declared per case: `json_format` (optionally with required
keys; a code fence can be allowed), `max_words`, `min_words`, `required_terms` (all/any),
`forbidden_terms`, `forbidden_format` (Markdown table, code block, bullet list).

### E. Latency — `latency-threshold/v1`
Latency is the **round trip measured by AtlasGuard**, from sending the request to receiving
the complete response body. It includes network, tunnel and queueing time and is **not**
pure model inference time. When the endpoint reports its own generation time (AtlasGuard's
inference service does, as `atlasguard.inference_ms`), it is stored separately as
`providerInferenceMs`. Latency only affects a verdict when a case declares `max_latency_ms`;
otherwise it is recorded for information.

## 4. Cross-language consistency — `fact-alignment/v1`

For every semantic group with at least two answered languages in a run, AtlasGuard aligns
the fact-check outcomes of all variants:

| Finding | Severity | When |
|---|---|---|
| `numeric_conflict` | conflict | two languages assert different values for the same numeric fact |
| `entity_conflict` | conflict | two languages assert different entities for the same entity fact |
| `possible_contradiction` | review | a concept fact is supported in one language and lexically contradicted in another |
| `fact_omission` | omission | a fact is found in some languages but not in others (or in none) |
| `uncertain_fact` | review | at least one language could not be decided |
| `missing_response` | review | a language variant errored, was skipped or did not run |
| `consistent_error` | info | all languages agree on a value that contradicts the reference |
| `consistent_fact` | info | the fact is supported in every compared language |

Group verdicts: `INCONSISTENT` if any confirmed conflict exists; otherwise `NEEDS_REVIEW`
if there are omissions, uncertain findings or missing responses; `CONSISTENT` when every
shared fact is supported in every compared language; `INSUFFICIENT_DATA` when fewer than two
languages answered or no fact is shared.

**An omission is not a contradiction.** A Hausa answer that simply does not mention the
total is reported as a missing fact; only a Hausa answer that states a *different* total is
a contradiction. Consistency is about agreement between languages — a group can be
consistent while every language is wrong (`consistent_error`), and that is reported too.

## 5. Aggregation and scores

For any set of results (a run, a language, a category, a language × category cell):

* **Verified pass rate = PASSED / (PASSED + FAILED)**, using the human decision where one
  exists. `NEEDS_REVIEW`, `ERROR`, `SKIPPED` and unexecuted cases are excluded from the
  denominator and always reported as separate counts. When nothing is decided the pass
  rate is `null` and the UI shows "—" or "Not yet evaluated", never 0 %.
* **Latency** statistics (mean and median) include only results that produced a response.
* Consistency summaries count groups by verdict and the number of confirmed contradictions.

Counters are re-derived from stored results after every case, so a case can never be
counted twice (results are unique per run and case, and each case is claimed atomically).

## 6. Human review

* **Benchmark content** (prompts, translations, reference facts) starts as `draft` or
  `pending_review`. Marking a case `verified` requires an explicit attestation that the
  reviewer is fluent in the language and has checked the prompt, translation and facts;
  the reviewer's name and time are stored in its provenance. Official suites can only be
  reviewed by administrators. AI-assisted drafts are never presented as verified.
* **Evaluation results** can be reviewed by the project owner; the decision becomes the
  final verdict and the review history is kept.

## 7. Reproducibility

Every run stores the benchmark slug, version and SHA-256 content hash; a snapshot of each
case; the model identifier and the revision reported by the endpoint; provider details
(dtype, quantization, device, runtime); generation parameters and system prompt; and the
evaluator version. The AtlasGuard inference service also reports the date string it passed
to the N-ATLaS chat template. With temperature > 0, outputs can differ between runs; use
temperature 0 or a fixed seed when comparing runs, and compare runs with the Reports page,
which warns about any difference in benchmark content, model, parameters or evaluator.

## 8. Limitations

* Checks are lexical and numeric; they do not understand meaning. `PASSED` means "no
  automated check found a problem", not proof of correctness.
* The current Nigerian Context Benchmark (57 cases) was drafted with AI assistance and is
  **pending review by fluent speakers**. Until cases are verified, treat results as
  indicative.
* Language identification is a heuristic tuned on short benchmark-style answers; it is less
  reliable for very short text, heavy code-switching and closely related varieties.
* Numbers written in words are recognised only where the dataset provides reviewed word
  forms.
* Latency depends on the hardware, network and tunnel in front of the inference endpoint
  and is not comparable across deployments.
