# Real BLINDED REAL‑LISTING ADDRESS FINDER Pilot Driver

## Goal Description
Replace the synthetic scaffold in `scratch/run_blinded_real_listing_pilot.py` with a fully‑wired driver that performs real public discovery on the **CHAVES NA MÃO** site (Taubaté only), captures authentic snapshots, extracts production‑visible clues, classifies direct leakage, runs the frozen Address Finder prediction pipeline, and provides a proper evaluation workflow. The driver must enforce strict safety, stage‑wise execution, and never perform live crawling, ground‑truth collection, or model inference without explicit user commands.

## User Review Required

> [!IMPORTANT]
> The following design decisions require your explicit approval:
> - **Discovery implementation**: Use the existing `address_finder.crawlers.chaves_na_mao.discover` utility to fetch public listing URLs, respecting the public‑only, no‑auth, no‑CAPTCHA constraints.
> - **Snapshot storage**: Store raw HTML (and any publicly available images) under `data/address_finder_real_listing_pilot/snapshots/<listing_id>/`. Binary files are excluded from Git; a manifest with SHA‑256 hashes will be committed.
> - **Public‑input extraction**: Parse snapshots via `address_finder.parsers.public_clues.extract_from_snapshot` to generate real production‑visible clues.
> - **Direct leakage classification**: Integrate `address_finder.leakage.classify` and persist per‑listing results in `brain/address_finder/phase_direct_leakage.json`.
> - **Prediction generation**: Invoke the frozen pipeline (`address_finder.pipeline.run_frozen_predictions`) to obtain real candidates, structural hypotheses, scores, features, and provenance.
> - **Ground‑truth ingestion**: Implement a separate `--stage ingest-gt` that reads a user‑provided GT JSON only after all frozen artifacts exist; it must reject any attempt to run before the hash gate passes.
> - **Evaluation**: Compare predictions against GT using `address_finder.evaluation.compare`, producing the three standard evaluation artifacts.
> - **Failure taxonomy**: Use the pre‑registered taxonomy at `brain/address_finder/failure_taxonomy.json`.
> - **Facade Checker guard**: Record a guard file (`brain/address_finder/facade_guard.json`) containing the frozen predictions hash and TOP‑3 REAL candidate IDs; the external Facade Checker will read this guard but will not be executed now.
> - **Validate‑only mode**: Extend validation to check imports, schemas, hash consistency, state‑gate behavior, and ensure no network I/O or artifact writes.
> - **CLI structure**: Use explicit `--stage <name>` sub‑commands (discovery, snapshots, inputs, classify-leakage, predict, ingest‑gt, evaluate, facade‑guard) or `--validate-only`.
>
>Please confirm or adjust any of the above before we proceed.

## Open Questions

> [!WARNING]
> - **Discovery ordering**: Should listings be ordered alphabetically by URL, numerically by ID extracted from the URL, or by a deterministic hash of page content?
> - **Eligibility filters**: Besides municipality (`Taubaté`) and property type (`casa`/`sobrado`), are there additional public criteria (e.g., presence of an exterior image URL)?
> - **Snapshot URL handling**: Should the original source URL be stored in `source_url.txt` alongside each snapshot?
> - **Hash algorithm**: Continue using `hashlib.sha256` for all artifact hashes?
> - **Failure taxonomy location**: Confirm the taxonomy file path is `brain/address_finder/failure_taxonomy.json`.

## Proposed Changes

---
### 1. Discovery Stage (`--stage discovery`)
- Replace `freeze_discovery_pool()` with:
  ```python
  from address_finder.crawlers.chaves_na_mao import discover
  urls = discover(municipality="Taubaté", source=LISTING_SOURCE)
  ```
- Apply deterministic sorting (`sorted(urls)`).
- Derive a stable `listing_id` from the URL (e.g., last path component).
- Filter eligibility using `address_finder.filters.is_eligible(html)` (public‑visible criteria).
- Persist JSON to `DISCOVERY_POOL_PATH` with fields `source`, `municipality`, `generated_at`, `eligible_listing_ids`.
- Write accompanying `.sha256` hash file.

---
### 2. Snapshot Stage (`--stage snapshots`)
- For each selected `listing_id` retrieve the page with `requests.get(url, timeout=10)` (unauthenticated GET only).
- Save raw HTML as `snapshot_root/<listing_id>/page.html`.
- Download any publicly referenced images (respecting robots.txt) into the same folder.
- Record per‑listing manifest entry:
  ```json
  {"listing_id": "...",
   "relative_path": "data/.../snapshots/...",
   "size_bytes": <int>,
   "source_url": "...",
   "retrieved_at": "...",
   "sha256": "..."}
  ```
- Write `SNAPSHOT_MANIFEST_PATH` and its hash.

---
### 3. Public Input Extraction (`--stage inputs`)
- Use `address_finder.parsers.public_clues.extract_from_snapshot(snapshot_dir)` to obtain production‑visible clues.
- Persist as `PUBLIC_INPUTS_PATH` (list of clues per listing) and hash.

---
### 4. Direct Leakage Classification (`--stage classify-leakage`)
- Call `address_finder.leakage.classify(public_clues)` which returns a dict `{listing_id: bool}`.
- Store in `brain/address_finder/phase_direct_leakage.json` with hash.

---
### 5. Prediction Generation (`--stage predict`)
- Invoke the frozen pipeline:
  ```python
  from address_finder.pipeline import run_frozen_predictions
  predictions = run_frozen_predictions(snapshot_root, public_inputs_path)
  ```
- The returned JSON must contain:
  - `observed_candidates`
  - `structural_hypotheses`
  - Scores, features, provenance, ranking.
- Write to `FROZEN_PREDICTIONS_PATH` and hash.

---
### 6. Ground‑Truth Ingestion (`--stage ingest-gt`)
- First run `gate_ground_truth()` to verify all prior artifact hashes.
- Load user‑provided GT JSON (e.g., `brain/address_finder/ground_truth_input.json`).
- Persist as `GROUND_TRUTH_PATH` with hash. **Synthetic GT must never be written in this mode.**

---
### 7. Evaluation (`--stage evaluate`)
- Use `address_finder.evaluation.compare(frozen_predictions_path, ground_truth_path, failure_taxonomy_path)`.
- Produce:
  - `*_evaluation.json`
  - `*_failure_analysis.json`
  - `*_metrics_summary.json`
- Metrics include address match, BC match, DSQLLL match, Top‑k accuracy.

---
### 8. Failure Taxonomy (`brain/address_finder/failure_taxonomy.json`)
- Ensure the driver loads this taxonomy and includes per‑listing failure codes in the failure‑analysis artifact.

---
### 9. Facade Checker Guard (`--stage facade-guard`)
- After predictions are frozen, create `facade_guard.json` containing:
  ```json
  {"predictions_sha256": "...",
   "timestamp": "...",
   "top3_real_candidate_ids": ["...", "...", "..."]}
  ```
- This file is the only signal permitting the external Facade Checker to run later.

---
### 10. Validation Mode (`--validate-only`)
- Verify importability of all modules used in the driver.
- Check that configuration constants exist.
- Confirm artifact directories are writable but **do not write** any artifact.
- Compute expected SHA‑256 for any pre‑existing artifacts and compare; fail on mismatch.
- Mock `requests.get` to raise if invoked, ensuring no network calls.
- Verify that the state‑gate (`gate_ground_truth`) blocks GT ingestion before all hashes are present.
- Report success or detailed failures.

---
### 11. CLI Structure
- Use `argparse` sub‑parsers:
  ```bash
  python scratch/run_blinded_real_listing_pilot.py --stage discovery
  python scratch/run_blinded_real_listing_pilot.py --stage snapshots
  python scratch/run_blinded_real_listing_pilot.py --stage inputs
  python scratch/run_blinded_real_listing_pilot.py --stage classify-leakage
  python scratch/run_blinded_real_listing_pilot.py --stage predict
  python scratch/run_blinded_real_listing_pilot.py --stage ingest-gt
  python scratch/run_blinded_real_listing_pilot.py --stage evaluate
  python scratch/run_blinded_real_listing_pilot.py --stage facade-guard
  python scratch/run_blinded_real_listing_pilot.py --validate-only
  ```
- No default stage; invoking the script without `--stage` prints usage and exits.

---
## Verification Plan
1. **Static analysis** – run `python -m pycodestyle` on the driver after implementation.
2. **Unit tests** – add minimal tests in `scratch/test_driver.py` that mock network calls and verify each stage writes the expected artifact and hash.
3. **Git integrity** – after commit, capture `git rev-parse HEAD` and the blob SHA of the driver file.
4. **Safety check** – execute `--validate-only` and confirm no network activity (mocked `requests.get`).
5. **Manual review** – ensure no live crawling or GT ingestion occurs during implementation.

---
**Please approve the plan or provide adjustments.**

STOP_FOR_HUMAN_REVIEW
