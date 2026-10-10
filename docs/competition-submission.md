# National AI Innovation Challenge 2026 — submission checklist

Track: **Developer Infrastructure**. Deadline: **12 October 2026, 11:59 PM WAT**.

This file tracks evidence honestly. Update the status column only when the item is actually
done; link the proof.

| Requirement | How AtlasGuard meets it | Status |
|---|---|---|
| Functioning technical application | API + dashboard + worker + SDK; 180+ automated tests | Built and tested locally |
| Genuine integration with N-ATLaS | `NatlasProvider` + inference service serving the official `NCAIR1/N-ATLaS` weights; evidence bundle per run | **Pending: run on a GPU host and export evidence** |
| Tooling that makes N-ATLaS easier to use/evaluate | Benchmarks, evaluation engine, cross-language consistency, API/SDK, reports | Built |
| Reproducible evaluation results | Run provenance (benchmark hash, case snapshots, model revision, parameters, evaluator version) | Built |
| Technical documentation | `README.md`, `docs/*`, OpenAPI | Written |
| ≥ 2 external beta testers | Beta guide + consented in-app feedback + evidence folder | **Pending: recruit and run sessions** |
| End-to-end demonstration | Demo script below | **Pending: record after real integration** |
| 3–5 minute video | — | **Pending** |
| Deployed application / repository | Repositories: [atlasguard-backend](https://github.com/kobiowuquadri/atlasguard-backend), [atlasguard-frontend](https://github.com/kobiowuquadri/atlasguard-frontend) (private until submission); deployment guide | **Pending: make public + deploy** |

## Release blockers (must be true before submitting)

- [ ] A completed evaluation run with the **N-ATLaS** configuration (not fixtures) on the
      deployed platform, and its evidence bundle saved under `evidence/integration/`.
- [ ] `pnpm smoke:natlas` output saved under `evidence/integration/`.
- [ ] At least two real external testers completed sessions and submitted consented feedback.
- [ ] Fixture provider disabled on the deployed API (no development banner).

## Suggested demo (≈ 4 minutes)

1. *Problem (20 s):* equivalent questions in four Nigerian languages can get different facts.
2. *Model status (15 s):* settings page shows N-ATLaS connected — served model, revision,
   runtime.
3. *Benchmarks (30 s):* a semantic group with its four language variants, reference facts,
   provenance and pending-review status.
4. *Run (45 s):* start an evaluation on N-ATLaS; live progress.
5. *Results (45 s):* expand a case — prompt, actual N-ATLaS response, checks with evidence,
   latency.
6. *Signature feature (45 s):* the cross-language tab — a contradiction vs an omission,
   responses side by side.
7. *Developer integration (20 s):* SDK snippet / API key; CSV and Markdown export; evidence
   bundle.
8. *Integrity (20 s):* simulated runs are labelled and cannot be exported as evidence;
   human review; limitations.

Only use real N-ATLaS runs in the video; if a fixture run appears, say on screen that it is
simulated.
