"""Rank document categories and documents by how hard the models found them.

    npm run difficulty            # or: python3 02-document-screening/difficulty.py

Reads the verified per-item scores (07-results/source/DocWeaver_Complete_Evaluation.xlsx) and
averages them over all six model setups. Each job is scored 0-100%:
  summary          the judge's weighted overall
  page labels      share of pages labelled correctly
  extraction       reviewed field score (correct 1, partly correct 0.5, wrong 0); excluded fields skipped
"Overall" is the plain mean of the three jobs. Lower means harder.
"""
import collections
import json
import os
import statistics
import sys

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl is required: python3 -m pip install --user openpyxl")

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(PROJECT, "07-results/source/DocWeaver_Complete_Evaluation.xlsx")
REFERENCE = os.path.join(PROJECT, "01-ground-truth-annotation/data/final-reference.json")


def sheet_rows(workbook, name):
    """Rows of a detail sheet as dicts; the header is on row 4."""
    rows = list(workbook[name].iter_rows(min_row=4, values_only=True))
    header = rows[0]
    return [dict(zip(header, row)) for row in rows[1:] if row[0]]


def mean_pct(values):
    return round(100 * statistics.mean(values), 1) if values else None


workbook = openpyxl.load_workbook(SOURCE, data_only=True)
reference = json.load(open(REFERENCE))
category_of = {d["id"]: d["category"] for d in reference["documents"]}
pages_of = {d["id"]: len(d["classification"]) for d in reference["documents"]}

# document id → job → list of 0-1 scores, one entry per model (or per page / field)
scores = collections.defaultdict(lambda: collections.defaultdict(list))
for row in sheet_rows(workbook, "Summary Detail"):
    scores[row["Document"]]["summary"].append(row["Overall"])
for row in sheet_rows(workbook, "Classification Detail"):
    scores[row["Document"]]["labels"].append(1 if row["Result"] == "Correct" else 0)
for row in sheet_rows(workbook, "Extraction Detail"):
    if row["Included in score"] == "Included":
        scores[row["Document"]]["extraction"].append(row["Reviewed score"])

JOBS = ["summary", "labels", "extraction"]


def summarise(groups):
    table = []
    for key, by_job in groups.items():
        per_job = {job: mean_pct(by_job[job]) for job in JOBS}
        overall = round(statistics.mean(v for v in per_job.values() if v is not None), 1)
        table.append((key, per_job, overall))
    return sorted(table, key=lambda t: -t[2])


by_category = collections.defaultdict(lambda: collections.defaultdict(list))
for doc, by_job in scores.items():
    for job in JOBS:
        by_category[category_of[doc]][job].extend(by_job[job])

print("By category (easiest first; all six model setups)\n")
print(f"{'category':<14}{'summary':>9}{'labels':>9}{'extract':>9}{'overall':>9}")
for name, per_job, overall in summarise(by_category):
    print(f"{name:<14}" + "".join(f"{per_job[j]:>8}%" for j in JOBS) + f"{overall:>8}%")

print("\nBy document (easiest first)\n")
print(f"{'document':<52}{'pages':>6}{'summary':>9}{'labels':>9}{'extract':>9}{'overall':>9}")
for doc, per_job, overall in summarise(scores):
    print(f"{doc[:51]:<52}{pages_of[doc]:>6}" + "".join(f"{per_job[j]:>8}%" for j in JOBS) + f"{overall:>8}%")
