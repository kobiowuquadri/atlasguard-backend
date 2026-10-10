/** Methodology and limitations text embedded in every report (kept next to the code it describes). */
export const METHODOLOGY = {
  verdicts:
    'Each case receives PASSED, FAILED, NEEDS_REVIEW, SKIPPED or ERROR. FAILED means at least one deterministic check failed. NEEDS_REVIEW means no check failed but at least one could not be decided automatically. ERROR is a technical failure (e.g. the endpoint timed out) and is never counted as a model failure. SKIPPED cases were not executed (run cancelled or stopped).',
  passRate:
    'Verified pass rate = PASSED / (PASSED + FAILED), using the human decision where a reviewer has judged the case. NEEDS_REVIEW, SKIPPED, ERROR and unexecuted cases are excluded from the denominator and reported separately.',
  responseValidity: 'A response is valid when it is non-empty (after removing special tokens) and the endpoint reports the configured model.',
  language:
    'Language compliance uses lexicon-orthography/v1: weighted function-word lexicons for English, Yoruba, Hausa, Igbo and Nigerian Pidgin plus orthographic markers (ẹ, ṣ, ị, ụ, ɗ, ƙ, …). Confidence is a heuristic score, not a probability. Very short responses, code-switching and Pidgin-for-English are routed to review rather than failed.',
  facts:
    'Numeric facts (numeric-extraction/v1) look for the expected value in digits or in reviewed word forms; a single different candidate value is a contradiction, several candidates or no digits need review. Entity facts (entity-match/v1) match reviewed surface forms and known conflicting entities; a missing required entity fails. Concept facts (concept-lexical/v1) use reviewed evidence phrases; because lexical matching cannot establish meaning, misses, negations and contradictions are always sent to human review, never failed automatically.',
  instructions:
    'Instruction rules (JSON validity and required keys, word limits, required/forbidden terms, forbidden formats) are deterministic pass/fail checks.',
  latency:
    'Latency is the round trip measured by AtlasGuard from sending the request to receiving the complete response. It includes network and queueing time and is not pure model inference time; provider-reported generation time is shown separately when the endpoint supplies it.',
  consistency:
    'Cross-language consistency (fact-alignment/v1) compares fact-check outcomes for equivalent prompts in a semantic group. Different values for the same numeric or entity fact are confirmed conflicts. A fact supported in one language and lexically contradicted in another is a possible contradiction for review. A fact missing in one language is an omission, which is reported separately and never counted as a contradiction.',
  reproducibility:
    'Every run records the benchmark version and content hash, a snapshot of each case, the model identifier and revision, provider-reported model details, generation parameters and the evaluator version. With temperature > 0, model outputs may vary between runs.',
};

export const LIMITATIONS = [
  'Automated checks are lexical and numeric; they do not understand meaning. Treat PASSED as "no automated check found a problem", not as proof of correctness.',
  'Benchmark prompts, translations and reference facts marked pending_review were drafted with AI assistance and have not yet been verified by fluent speakers.',
  'Language identification is a transparent heuristic and is less reliable for short responses, code-switched text and closely related varieties.',
  'Numbers written out in words are only recognised when the dataset provides reviewed word forms.',
  'Latency depends on the hosting hardware and network of the inference endpoint and is not comparable across deployments.',
];
