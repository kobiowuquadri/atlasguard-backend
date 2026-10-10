# Evidence

Real artefacts only — nothing in this folder may be invented, edited to look better, or
produced by simulated fixtures.

```
evidence/
  integration/     N-ATLaS integration evidence
    YYYY-MM-DD-smoke.txt              output of `pnpm smoke:natlas`
    YYYY-MM-DD-run-<id>.json          "N-ATLaS integration evidence" export of a completed real run
    YYYY-MM-DD-model-status.json      GET /api/v1/model/status at the time of the run
  beta-testing/    one file per session: date, tester identifier, version, tasks attempted, issues observed
    feedback-export.json              Settings → Export consented feedback (administrators)
  fixes/           issues reported by testers and the commits that fixed them
  screenshots/     only screenshots that testers agreed to share
```

Rules:

* Evidence bundles include a SHA-256 digest; do not modify them after export.
* Store tester data only with recorded consent; prefer pseudonymous identifiers.
* Never commit API keys, Hugging Face tokens, tunnel URLs with keys, or `.env` files.
