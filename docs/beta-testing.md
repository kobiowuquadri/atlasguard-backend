# Beta testing guide

Thank you for testing AtlasGuard. A session takes about 20–30 minutes. Please test on your
own; we only learn from what you actually experience.

## What you need

* The dashboard URL shared by the AtlasGuard team.
* A modern browser. Developers who want to try the API also need a terminal with `curl`
  or Node.js 18+.

## Tasks

1. **Open the platform** and read the landing page. Is it clear what AtlasGuard does?
2. **Create an account** (any email you can remember; it is not verified).
3. **Create a project** for an imaginary application you might build on N-ATLaS.
4. **Browse the benchmark suite.** Open a few cases in different languages and look at the
   prompt, the reference facts and the review status.
5. **Run an evaluation** (*New evaluation*): choose your project, the Nigerian Context
   Benchmark, two or more languages and the **N-ATLaS** configuration. A small selection
   (e.g. one category, two languages) finishes fastest.
6. **Inspect the results.** Expand a few cases: compare the prompt, the model's actual
   response, the reference facts and each check's explanation. Find one case that needs
   review and, if you can judge it, record a decision.
7. **Review a cross-language comparison** (*Cross-language* tab). Can you tell a
   contradiction from a missing fact?
8. **Try the API or SDK** (optional): create an API key on *Developer API* and run one of the
   examples.
9. **Download a report** (CSV or Markdown) from *Reports*.
10. **Submit feedback** on the *Beta feedback* page (sidebar). Tell us what was useful,
    confusing or broken.

## About the data

* If N-ATLaS is temporarily unavailable you may see a "not reachable" message; AtlasGuard
  will not substitute another model. Please note it in your feedback.
* Benchmark translations are AI-assisted drafts pending review. If you are fluent in Yoruba,
  Hausa or Igbo, comments on the prompts are very welcome.
* We collect only what you type into the feedback form plus your account email. With your
  consent, your feedback and chosen identifier may be cited as evidence of real-world
  testing in our National AI Innovation Challenge submission. You can withdraw consent by
  contacting the team.

## For the AtlasGuard team

* Record each session in `evidence/beta-testing/` (date, tester identifier, version, tasks
  attempted, issues observed) — see [the evidence guide](../evidence/README.md).
* Export consented feedback from *Settings → Export consented feedback* (administrators).
* Never write feedback on a tester's behalf, and never invent testers or quotes.
