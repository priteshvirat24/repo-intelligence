# Evaluation report: suite-v1

Labels: draft: one AI-drafted label set, not yet independently labelled or reviewed (see eval/README.md)

Values are means over runs, with the range across runs in brackets. Each run is the macro average over briefs.

| Metric | B0 (1 run) | B0S (1 run) | B1:CATEGORY-QUERIES (3 runs) | B1:CATEGORY-QUERIES-FRESH (3 runs) | B1:DEFAULT (3 runs) |
|---|---|---|---|---|---|
| Recall@10 | 0.063 | 0.063 | 0.322 (0.278–0.348) | 0.295 (0.258–0.343) | 0.111 (0.104–0.116) |
| Recall (all kept) | 0.063 | 0.063 | 0.413 (0.382–0.446) | 0.385 (0.380–0.395) | 0.227 (0.207–0.246) |
| Shortlist precision | 0.033 | 0.033 | 0.223 (0.211–0.239) | 0.234 (0.221–0.256) | 0.091 (0.089–0.095) |
| Trap rejection (all traps) | 1.000 | 1.000 | 0.792 (0.750–0.812) | 0.833 (0.812–0.875) | 0.979 (0.938–1.000) |
| Trap rejection (traps it found) | n/a | n/a | 0.450 (0.250–0.600) | 0.583 (0.500–0.750) | 0.667 (0.000–1.000) |
| LLM calls per run | 0 | 0 | 60 | 61 (60–62) | 60 (60–61) |
| Input tokens per run | 0 | 0 | 206638 (205004–208705) | 206526 (204429–208298) | 202405 (201749–203370) |
| Output tokens per run | 0 | 0 | 38197 (37787–38650) | 38336 (38049–38563) | 38941 (38601–39251) |
| Cost per run (cents) | 0.000 | 0.000 | not priced | not priced | not priced |
| Mean time per brief (s) | 0.0 | 1.2 | 68.6 (62.7–78.5) | 62.7 (59.7–65.2) | 69.7 (64.1–77.3) |
| Briefs with errors | 0 | 0 | 0 | 0 | 0 |

## Runs

| Run | System | Mode | Tuning | Commit | Model | Snapshot (recorded / replayed) |
|---|---|---|---|---|---|---|
| `b0-replay-20261021-122637` | b0 | replay | — | 76d0c77 | ministral-8b-latest | 0 / 30 |
| `b0s-record-20261021-122638` | b0s | record | — | 76d0c77 | ministral-8b-latest | 30 / 0 |
| `b1-fill-20261021-130138` | b1 | fill | cfg-02b30c8854db | d48988c | ministral-8b-latest | 201 / 104 |
| `b1-fill-20261021-131446` | b1 | fill | cfg-02b30c8854db | d48988c | ministral-8b-latest | 116 / 190 |
| `b1-fill-20261021-132533` | b1 | fill | cfg-02b30c8854db | d48988c | ministral-8b-latest | 69 / 235 |
| `b1-fill-20261021-133603` | b1 | fill | cfg-0289487be7e2 | f350b5b | ministral-8b-latest | 213 / 81 |
| `b1-fill-20261021-134930` | b1 | fill | cfg-0289487be7e2 | f350b5b | ministral-8b-latest | 115 / 177 |
| `b1-fill-20261021-135927` | b1 | fill | cfg-0289487be7e2 | f350b5b | ministral-8b-latest | 66 / 230 |
| `b1-fill-20261021-141020` | b1 | fill | cfg-d88eb2047d1a | 7462eec | ministral-8b-latest | 53 / 243 |
| `b1-fill-20261021-142026` | b1 | fill | cfg-d88eb2047d1a | 7462eec | ministral-8b-latest | 37 / 260 |
| `b1-fill-20261021-144931` | b1 | fill | cfg-d88eb2047d1a | 7462eec | ministral-8b-latest | 42 / 251 |

## Per brief

Recall@10 per run, and the essential repositories missed in the latest run of each system.

| Brief | B0 recall@10 | B0S recall@10 | B1:CATEGORY-QUERIES recall@10 | B1:CATEGORY-QUERIES-FRESH recall@10 | B1:DEFAULT recall@10 | Missed essentials (latest B0, B0S, B1:CATEGORY-QUERIES, B1:CATEGORY-QUERIES-FRESH, B1:DEFAULT) |
|---|---|---|---|---|---|---|
| geo-satellite-tracker | 0.200 | 0.200 | 0.600 | 0.600 | 0.400 | B0: brandon-rhodes/python-sgp4, cesiumgs/cesium, shashwatak/satellite-js, vasturiano/globe.gl<br>B0S: brandon-rhodes/python-sgp4, cesiumgs/cesium, shashwatak/satellite-js, vasturiano/globe.gl<br>B1:CATEGORY-QUERIES: cesiumgs/cesium, thkruz/keeptrack.space<br>B1:CATEGORY-QUERIES-FRESH: cesiumgs/cesium, thkruz/keeptrack.space<br>B1:DEFAULT: cesiumgs/cesium, shashwatak/satellite-js, vasturiano/globe.gl |
| geo-vector-tiles | 0.000 | 0.000 | 0.600 | 0.400 (0.200–0.600) | 0.533 (0.400–0.600) | B0: felt/tippecanoe, maplibre/maplibre-gl-js, maptiler/tileserver-gl, onthegomap/planetiler, protomaps/pmtiles<br>B0S: felt/tippecanoe, maplibre/maplibre-gl-js, maptiler/tileserver-gl, onthegomap/planetiler, protomaps/pmtiles<br>B1:CATEGORY-QUERIES: felt/tippecanoe, protomaps/pmtiles<br>B1:CATEGORY-QUERIES-FRESH: felt/tippecanoe, maplibre/maplibre-gl-js, maptiler/tileserver-gl, protomaps/pmtiles<br>B1:DEFAULT: maplibre/maplibre-gl-js, maptiler/tileserver-gl |
| geo-gps-routes | 0.000 | 0.000 | 0.400 | 0.400 | 0.200 | B0: graphhopper/graphhopper, leaflet/leaflet, project-osrm/osrm-backend, tkrajina/gpxpy, valhalla/valhalla<br>B0S: graphhopper/graphhopper, leaflet/leaflet, project-osrm/osrm-backend, tkrajina/gpxpy, valhalla/valhalla<br>B1:CATEGORY-QUERIES: graphhopper/graphhopper, leaflet/leaflet, valhalla/valhalla<br>B1:CATEGORY-QUERIES-FRESH: graphhopper/graphhopper, leaflet/leaflet, valhalla/valhalla<br>B1:DEFAULT: graphhopper/graphhopper, leaflet/leaflet, tkrajina/gpxpy, valhalla/valhalla |
| dev-pr-review-bot | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | B0: probot/probot, reviewdog/reviewdog, semgrep/semgrep, super-linter/super-linter<br>B0S: probot/probot, reviewdog/reviewdog, semgrep/semgrep, super-linter/super-linter<br>B1:CATEGORY-QUERIES: probot/probot, reviewdog/reviewdog, semgrep/semgrep, super-linter/super-linter<br>B1:CATEGORY-QUERIES-FRESH: probot/probot, reviewdog/reviewdog, semgrep/semgrep, super-linter/super-linter<br>B1:DEFAULT: probot/probot, reviewdog/reviewdog, semgrep/semgrep, super-linter/super-linter |
| dev-dependency-updates | 0.000 | 0.000 | 0.222 (0.000–0.333) | 0.333 | 0.000 | B0: changesets/changesets, dependabot/dependabot-core, renovatebot/renovate<br>B0S: changesets/changesets, dependabot/dependabot-core, renovatebot/renovate<br>B1:CATEGORY-QUERIES: changesets/changesets, dependabot/dependabot-core<br>B1:CATEGORY-QUERIES-FRESH: changesets/changesets, dependabot/dependabot-core<br>B1:DEFAULT: changesets/changesets, dependabot/dependabot-core, renovatebot/renovate |
| dev-docs-site | 0.000 | 0.000 | 0.222 (0.167–0.333) | 0.278 (0.167–0.333) | 0.000 | B0: facebook/docusaurus, mkdocstrings/mkdocstrings, pagefind/pagefind, sphinx-doc/sphinx, squidfunk/mkdocs-material, typestrong/typedoc<br>B0S: facebook/docusaurus, mkdocstrings/mkdocstrings, pagefind/pagefind, sphinx-doc/sphinx, squidfunk/mkdocs-material, typestrong/typedoc<br>B1:CATEGORY-QUERIES: facebook/docusaurus, mkdocstrings/mkdocstrings, pagefind/pagefind, sphinx-doc/sphinx, squidfunk/mkdocs-material<br>B1:CATEGORY-QUERIES-FRESH: facebook/docusaurus, mkdocstrings/mkdocstrings, pagefind/pagefind, sphinx-doc/sphinx, squidfunk/mkdocs-material<br>B1:DEFAULT: facebook/docusaurus, mkdocstrings/mkdocstrings, pagefind/pagefind, sphinx-doc/sphinx, squidfunk/mkdocs-material, typestrong/typedoc |
| data-postgres-cdc | 0.000 | 0.000 | 0.500 | 0.500 | 0.167 (0.000–0.500) | B0: debezium/debezium, peerdb-io/peerdb<br>B0S: debezium/debezium, peerdb-io/peerdb<br>B1:CATEGORY-QUERIES: debezium/debezium<br>B1:CATEGORY-QUERIES-FRESH: debezium/debezium<br>B1:DEFAULT: debezium/debezium, peerdb-io/peerdb |
| data-etl-quality | 0.000 | 0.000 | 0.389 (0.167–0.500) | 0.444 (0.333–0.500) | 0.056 (0.000–0.167) | B0: apache/airflow, dagster-io/dagster, dbt-labs/dbt, dlt-hub/dlt, fivetran/great_expectations, prefecthq/prefect<br>B0S: apache/airflow, dagster-io/dagster, dbt-labs/dbt, dlt-hub/dlt, fivetran/great_expectations, prefecthq/prefect<br>B1:CATEGORY-QUERIES: dbt-labs/dbt, dlt-hub/dlt, prefecthq/prefect<br>B1:CATEGORY-QUERIES-FRESH: dbt-labs/dbt, dlt-hub/dlt, prefecthq/prefect<br>B1:DEFAULT: apache/airflow, dagster-io/dagster, dbt-labs/dbt, dlt-hub/dlt, fivetran/great_expectations, prefecthq/prefect |
| data-log-pipeline | 0.000 | 0.000 | 0.083 (0.000–0.250) | 0.000 | 0.000 | B0: fluent/fluent-bit, grafana/grafana, grafana/loki, vectordotdev/vector<br>B0S: fluent/fluent-bit, grafana/grafana, grafana/loki, vectordotdev/vector<br>B1:CATEGORY-QUERIES: fluent/fluent-bit, grafana/grafana, grafana/loki<br>B1:CATEGORY-QUERIES-FRESH: fluent/fluent-bit, grafana/grafana, grafana/loki, vectordotdev/vector<br>B1:DEFAULT: fluent/fluent-bit, grafana/grafana, grafana/loki, vectordotdev/vector |
| llm-rag-citations | 0.000 | 0.000 | 0.048 (0.000–0.143) | 0.143 | 0.000 | B0: deepset-ai/haystack, docling-project/docling, langchain-ai/langchain, pgvector/pgvector, qdrant/qdrant, run-llama/llama_index, unstructured-io/unstructured<br>B0S: deepset-ai/haystack, docling-project/docling, langchain-ai/langchain, pgvector/pgvector, qdrant/qdrant, run-llama/llama_index, unstructured-io/unstructured<br>B1:CATEGORY-QUERIES: deepset-ai/haystack, docling-project/docling, langchain-ai/langchain, pgvector/pgvector, qdrant/qdrant, run-llama/llama_index, unstructured-io/unstructured<br>B1:CATEGORY-QUERIES-FRESH: deepset-ai/haystack, docling-project/docling, langchain-ai/langchain, pgvector/pgvector, qdrant/qdrant, unstructured-io/unstructured<br>B1:DEFAULT: deepset-ai/haystack, docling-project/docling, langchain-ai/langchain, pgvector/pgvector, qdrant/qdrant, run-llama/llama_index, unstructured-io/unstructured |
| llm-prompt-evals | 0.000 | 0.000 | 0.333 (0.000–0.500) | 0.167 (0.000–0.500) | 0.000 | B0: confident-ai/deepeval, promptfoo/promptfoo<br>B0S: confident-ai/deepeval, promptfoo/promptfoo<br>B1:CATEGORY-QUERIES: promptfoo/promptfoo<br>B1:CATEGORY-QUERIES-FRESH: confident-ai/deepeval, promptfoo/promptfoo<br>B1:DEFAULT: confident-ai/deepeval, promptfoo/promptfoo |
| llm-voice-agent | 0.500 | 0.500 | 0.333 (0.250–0.500) | 0.250 | 0.000 | B0: snakers4/silero-vad, systran/faster-whisper<br>B0S: snakers4/silero-vad, systran/faster-whisper<br>B1:CATEGORY-QUERIES: pipecat-ai/pipecat, snakers4/silero-vad, systran/faster-whisper<br>B1:CATEGORY-QUERIES-FRESH: pipecat-ai/pipecat, snakers4/silero-vad, systran/faster-whisper<br>B1:DEFAULT: livekit/agents, pipecat-ai/pipecat, snakers4/silero-vad, systran/faster-whisper |
| web-saas-auth | 0.250 | 0.250 | 0.250 | 0.250 | 0.000 | B0: keycloak/keycloak, nextauthjs/next-auth, ory/polis<br>B0S: keycloak/keycloak, nextauthjs/next-auth, ory/polis<br>B1:CATEGORY-QUERIES: better-auth/better-auth, keycloak/keycloak, nextauthjs/next-auth<br>B1:CATEGORY-QUERIES-FRESH: better-auth/better-auth, keycloak/keycloak, nextauthjs/next-auth<br>B1:DEFAULT: better-auth/better-auth, keycloak/keycloak, nextauthjs/next-auth, ory/polis |
| web-public-api | 0.000 | 0.000 | 0.400 | 0.333 (0.200–0.400) | 0.200 | B0: apache/apisix, kong/kong, openmeterio/openmeter, swagger-api/swagger-ui, unkeyed/unkey<br>B0S: apache/apisix, kong/kong, openmeterio/openmeter, swagger-api/swagger-ui, unkeyed/unkey<br>B1:CATEGORY-QUERIES: kong/kong, swagger-api/swagger-ui, unkeyed/unkey<br>B1:CATEGORY-QUERIES-FRESH: kong/kong, openmeterio/openmeter, swagger-api/swagger-ui, unkeyed/unkey<br>B1:DEFAULT: kong/kong, openmeterio/openmeter, swagger-api/swagger-ui, unkeyed/unkey |
| web-job-queue | 0.000 | 0.000 | 0.444 (0.333–0.667) | 0.333 | 0.111 (0.000–0.333) | B0: celery/celery, felixmosh/bull-board, taskforcesh/bullmq<br>B0S: celery/celery, felixmosh/bull-board, taskforcesh/bullmq<br>B1:CATEGORY-QUERIES: celery/celery, felixmosh/bull-board<br>B1:CATEGORY-QUERIES-FRESH: celery/celery, felixmosh/bull-board<br>B1:DEFAULT: celery/celery, felixmosh/bull-board |
