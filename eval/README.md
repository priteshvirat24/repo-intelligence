# Evaluation suite and labelling protocol

This directory holds the outcome-level evaluation defined in [SYSTEM_DESIGN.md §10](../docs/SYSTEM_DESIGN.md#10-evaluation-plan). It measures whether Open Eye finds the right existing solutions for a brief, as opposed to the unit checks in `tests/`.

```text
eval/
  README.md                this protocol
  suite-v1/
    suite.json             version, label status, brief ids
    briefs/<id>.json       one brief and its labels
    label-check.json       facts checked on GitHub for every labelled repository
  results/suite-v1/        one JSON file per evaluation run (committed)
  snapshots/suite-v1/      recorded GitHub and search responses (not committed; see Snapshots)
  work/                    intermediate files per run (not committed)
```

## Current status

**suite-v1 labels are a draft.** They were written by one AI labeller and checked against GitHub for existence, renames, archival, last push and licence. They have **not** been labelled independently by two people, as the protocol below requires.

Numbers measured against them are therefore **provisional**. They show whether the harness works and roughly where the system stands, but they are not yet a baseline to promote changes against. The baseline becomes final when two reviewers have completed steps 1–4 of the protocol and `suite.json` `labelsStatus` says so.

## What a brief file contains

```json
{
  "id": "geo-satellite-tracker",
  "domain": "geospatial-visualisation",
  "outsideTeamExpertise": true,
  "title": "Satellite tracker web app",
  "brief": "The brief text exactly as a user would submit it.",
  "labels": {
    "status": "draft | reviewed | final",
    "labelledBy": ["..."],
    "reviewedBy": ["..."],
    "requirements": [
      {
        "id": "propagation",
        "name": "Orbit propagation from TLEs with SGP4",
        "criticality": "MUST | SHOULD | NICE_TO_HAVE",
        "type": "functional | technical | integration | deployment | performance | domain",
        "expectedClass": 2,
        "solutions": [{ "repo": "owner/name", "rating": "essential | acceptable" }]
      }
    ],
    "products": [{ "repo": "owner/name", "rating": "essential | acceptable" }],
    "traps": [{ "repo": "owner/name", "reason": "Why it must not be recommended, stated so it can be checked" }]
  }
}
```

### Ratings

| Rating | Meaning | Test |
|---|---|---|
| **essential** | A senior engineer who knows the field would expect any serious research to find it for this requirement | "If the blueprint missed this, I would distrust the whole blueprint" |
| **acceptable** | A reasonable choice, but missing it is not an error | "I would not object if it were recommended" |
| *(unlabelled)* | Neither | Unlabelled results count as neither right nor wrong for recall, and as not relevant for shortlist precision |

`products` lists existing whole products comparable to the brief, as opposed to components for one requirement.

### Expected class

These are the six build-vs-reuse classes from [PRODUCT_DEFINITION.md §5.4](../docs/PRODUCT_DEFINITION.md):
1. available and verified;
2. available, needs configuration or integration;
3. available, needs modification;
4. partially solved;
5. missing, must be built;
6. unresolved: cannot be decided from evidence alone, for example a scale target that needs a benchmark.

### Traps

A trap is a repository that **looks** like a match but must not be recommended for reuse or adapt. A trap needs a reason a reviewer can check:
- it is archived or has had no push for more than two years;
- its licence prevents reuse;
- it does something adjacent (for example MySQL-only when the brief needs PostgreSQL);
- its own documentation points to a successor.

`verify_labels` flags any trap that is active, licensed and has no stated reason.

## Labelling protocol

1. **Write the brief before looking at any system output.** The brief describes a realistic product and is not edited afterwards to make the system look better.
2. **Two people label each brief independently.** They see the brief, but no Open Eye output and not each other's labels. Each one writes:
   - requirements with criticality and type;
   - per requirement, the essential and acceptable solutions they know of or can find with their own research, recording where they found each;
   - products;
   - traps with reasons;
   - the expected class per requirement.
3. **Check the facts.** Run `python -m apps.worker.eval.verify_labels eval/suite-v1 --fix`. Every repository must exist, and renamed repositories are rewritten to their current names. Archived solutions and unexplained traps are resolved before moving on.
4. **Reconcile.** For each requirement, the two labellers compare lists:
   - a solution both rated essential stays essential;
   - a solution rated essential by one only is discussed: it becomes essential or acceptable, and the disagreement is recorded;
   - expected classes are discussed until agreed.

   Report agreement in `suite.json`: the share of essential solutions both found independently, and the share of requirements whose class both chose. A brief with essential-solution agreement below 0.5 is rewritten (step 1), because it is not specific enough to have a ground truth.
5. **Freeze.** Set `labels.status` to `final` and record both names in `labelledBy`. From then on labels change only through a new suite version, never in place.

**Adding cases:**
- Add briefs over time: every failure seen in production becomes a case.
- Never remove a case to improve numbers. Retire it only in a new suite version, with the reason recorded.
- Keep at least 30% of briefs in domains outside the team's expertise (`outsideTeamExpertise`).

## Running the harness

The database must be reachable (the harness reads the cost ledger from `provider_usage`), and `GITHUB_TOKEN` and the LLM key must be set.

```bash
# B0: plain-search baseline (GitHub search on the title + search-provider GitHub results)
python -m apps.worker.eval.run --suite eval/suite-v1 --system b0 --mode record
# B0s: the same with GitHub results sorted by stars, the stricter baseline targets must beat
python -m apps.worker.eval.run --suite eval/suite-v1 --system b0s --mode record

# B1: Open Eye. Record once (live GitHub, stored), then replay
python -m apps.worker.eval.run --suite eval/suite-v1 --system b1 --mode record
python -m apps.worker.eval.run --suite eval/suite-v1 --system b1 --mode replay --requirements-from <record run id>

# A candidate tuning, on the same recorded inputs and the same decomposition. fill serves recorded
# responses and fetches (and stores) only requests the recording does not have, e.g. new queries
python -m apps.worker.eval.run --suite eval/suite-v1 --system b1 --mode fill --requirements-from <run id> --tuning candidate.json

# Summarise runs into a report
python -m apps.worker.eval.report eval/results/suite-v1/<run>.json ...
```

- **record:** calls GitHub and the search provider live and stores every response.
- **replay:** serves only stored responses. A request missing from the snapshot fails that brief (`REPLAY_MISS`), because the run would no longer be comparable.
- **fill:** serves stored responses and fetches only the missing ones, storing them. Use it when the system issues different requests than the recording (a changed planner, or the LLM choosing different queries). Requests both runs share still see the same recorded world; each result records how many responses were fetched live.
- **LLM calls are never replayed.** They run live in every mode, so replay runs differ only by model nondeterminism. Run a configuration at least three times and compare means with their spread.
- **`--requirements-from`** reuses an earlier run's decomposition. Use it when a change concerns discovery or ranking, so decomposition noise does not mask the difference.

## Metrics computed today

| Metric | Computation |
|---|---|
| `recallAt10` | Essential repositories (any requirement or product) in the top 10 of the ranking, divided by all essential repositories of the brief |
| `recallAll` | The same over every candidate the system kept (up to 40) |
| `shortlistPrecision` | Shortlisted repositories rated essential or acceptable, divided by the shortlist size. For B0 the top 6 stand in for a shortlist. |
| `trapRejection` | Traps not shortlisted, divided by traps |
| LLM calls, tokens, cost | From `provider_usage`, scope `eval` / `<run id>:<brief id>`. Cost is reported only when `LLM_PRICES_JSON` prices the model. |
| Duration | Wall-clock time per brief, including decomposition |

Classification accuracy and requirement coverage need the six-class blueprint (Phase 3). Evidence correctness and grade honesty need the human audit view (P1–P3). They are reported as not measured until then.

## Snapshots

Snapshots are content-addressed JSON files, keyed by a hash of method, URL and request body. Request headers are never stored, and credential fields are removed from bodies before hashing, so snapshots contain no tokens.

They are not committed (a few MB per brief). Until they move to object storage (Phase 1), a replay run is reproducible only on the machine that recorded it. Each result file records how many responses were recorded or replayed.
