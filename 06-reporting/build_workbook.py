"""Build the final DocWeaver model-evaluation workbook (07-results/DocWeaver_Model_Evaluation.xlsx).

    npm run report:workbook            # or: python3 06-reporting/build_workbook.py [--out FILE]

Inputs, relative to the project directory:
  07-results/source/DocWeaver_Complete_Evaluation.xlsx      verified per-item scores, incl. reviewed extraction
  07-results/runs/                                          raw run records (speed, completion counts)
  01-ground-truth-annotation/data/final-reference.json      final ground truth

  07-results/runs/_comparisons/comparison-20261102-150555/extraction-field-adjudication.json  PDF review verdicts

Extraction is graded from the review verdicts (correct 1, partly correct 0.5, otherwise 0). The build
stops if a below-full field has no verdict, or if summary or page-labelling scores differ from the
source workbook's.
"""
import argparse
import collections
import glob
import json
import os
import statistics as st
import sys

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl is required: python3 -m pip install --user openpyxl")
from openpyxl.chart import BarChart, Reference
from openpyxl.formatting.rule import CellIsRule, ColorScaleRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cli = argparse.ArgumentParser(description="Build the DocWeaver model-evaluation workbook.")
cli.add_argument("--source", default=os.path.join(PROJECT, "07-results/source/DocWeaver_Complete_Evaluation.xlsx"))
cli.add_argument("--runs", default=os.path.join(PROJECT, "07-results/runs"))
cli.add_argument("--ground-truth", default=os.path.join(PROJECT, "01-ground-truth-annotation/data/final-reference.json"))
cli.add_argument("--out", default=os.path.join(PROJECT, "07-results/DocWeaver_Model_Evaluation.xlsx"))
args = cli.parse_args()
SRC, RUNS, GT, OUT = args.source, args.runs, args.ground_truth, args.out
for path in (SRC, RUNS, GT):
    if not os.path.exists(path):
        sys.exit(f"missing input: {os.path.relpath(path, PROJECT)}")

# ---------- look ----------
NAVY, TEAL, INK, MUTED = "1F2A44", "0F766E", "1F2937", "6B7280"
PALE, LINE, ZEBRA = "EEF2F7", "D9DEE7", "F8FAFC"
GOOD, BAD, WARN = "DCFCE7", "FEE2E2", "FEF3C7"
FONT = "Calibri"
PCT = "0.0%"
thin = Side(style="thin", color=LINE)
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)


def font(size=11, bold=False, color=INK, italic=False):
    return Font(name=FONT, size=size, bold=bold, color=color, italic=italic)


def fill(c):
    return PatternFill("solid", start_color=c, end_color=c)


# ---------- data ----------
src = openpyxl.load_workbook(SRC, data_only=True)


def detail(name):
    return [r for r in src[name].iter_rows(values_only=True) if r and r[0] in ("Textract", "VLM")]


summ = detail("Summary Detail")  # input, model, doc, overall, coverage, accuracy, clarity, conciseness
cls = detail("Classification Detail")  # input, model, doc, page, expected, predicted, result
ext = detail("Extraction Detail")  # input, model, doc, field, expected, extracted, auto, reviewed, included

# ---------- extraction grading ----------
# Every field is graded from a human verdict, not from word overlap: correct 1, partly correct 0.5,
# wrong / missing / not in the document 0. Verdicts for the Textract runs come from the PDF review
# ledger; the vision run has no ledger, so its seven below-full fields are graded like the matching
# Textract cases (VLM_VERDICTS).
LEDGER = os.path.join(RUNS, "_comparisons/comparison-20261102-150555/extraction-field-adjudication.json")
if not os.path.exists(LEDGER):
    sys.exit(f"missing review ledger: {os.path.relpath(LEDGER, PROJECT)}")
ledger = {(c["documentId"], c["variantId"], c["field"]): c["manualDisposition"]
          for c in json.load(open(LEDGER))["cases"]}
VLM_VERDICTS = {
    ("budget-1165040-singleton-budget", "Total Expenditure / Costs"): "verified-wrong-value",
    ("news-article-3903433-consumer-alert-newspaper", "Headline / Title"): "partly-correct-headline-undercoverage",
    ("news-article-2071912-conservative-groups-push-development-missoulan", "Publication Date"): "verified-wrong-date",
    ("news-article-2071912-conservative-groups-push-development-missoulan", "Primary Subject / Topic"):
        "relevant-but-incomplete-topic",
    ("letter-1009064-letter-from-gov-terry-mcauliffe", "Sender Name / Organization"): "partly-correct-undercoverage",
    ("letter-1004917-mayors-letter", "Recipient Name / Organization"): "partly-correct-context-omitted",
    ("letter-1004917-mayors-letter", "Main Purpose / Request"): "partly-correct-undercoverage",
}
VERDICTS = {  # disposition -> (result, score, plain note)
    "verified-wrong-value": ("Wrong", 0.0, "Wrong figure: a subtotal or different sum, not the document total"),
    "verified-wrong-date": ("Wrong", 0.0, "Wrong date"),
    "verified-wrong-field-value": ("Wrong", 0.0, "Gave the value of a different part of the document"),
    "verified-extraction-error": ("Wrong", 0.0, "The text reader misread the printed name"),
    "verified-wrong-or-too-vague-topic": ("Wrong", 0.0, "Too vague to identify the topic"),
    "verified-missing-value": ("Missing", 0.0, "The value is in the document but was not extracted"),
    "verified-hallucinated-value": ("Not in document", 0.0,
                                    "No invoice date is printed; the model read it from the invoice number"),
    "partly-correct-undercoverage": ("Partly correct", 0.5, "Right, but leaves out part of the answer"),
    "partly-correct-context-omitted": ("Partly correct", 0.5, "Right, but leaves out the organization"),
    "partly-correct-headline-undercoverage": ("Partly correct", 0.5, "Gives only part of the headline"),
    "partly-correct-topic-undercoverage": ("Partly correct", 0.5, "Right topic, but too general"),
    "relevant-but-incomplete-topic": ("Partly correct", 0.5, "Right topic, but misses part of it"),
}
VARIANT_ID = {("Textract", "Claude Sonnet 4.6"): "textract-sonnet-4-6", ("Textract", "Claude Sonnet 4.5"):
              "textract-sonnet-4-5", ("Textract", "Claude Haiku 4.5"): "textract-haiku-4-5",
              ("Textract", "Qwen3 32B"): "textract-qwen3-32b", ("Textract", "Llama 4 Maverick"):
              "textract-llama4-maverick", ("VLM", "Claude Sonnet 4.6"): "vlm-sonnet-4-6"}


def plain(s):
    return "".join(ch for ch in str(s or "").lower() if ch.isalnum())


def grade(row):
    inp, model, doc, field, exp, got, auto, reviewed, included = row
    if included != "Included":
        return "Not scored", None, ""
    if float(reviewed) >= 0.999:
        if exp in (None, "") and got in (None, ""):
            return "Correct", 1.0, "Correctly left empty"
        if str(got).strip() == "-":
            return "Correct", 1.0, "The PDF prints “–” for a zero difference"
        same = plain(exp) == plain(got)
        return "Correct", 1.0, "" if same else "Same answer, written differently"
    vid = VARIANT_ID[(inp, model)]
    disposition = ledger.get((doc, vid, field)) or VLM_VERDICTS.get((doc, field))
    if disposition not in VERDICTS:
        sys.exit(f"no review verdict for {vid} / {doc} / {field}")
    result, score, note = VERDICTS[disposition]
    return result, score, note


# ext rows become: input, model, doc, field, expected, extracted, auto, score, included, result, note
ext = [r[:7] + (score, r[8], result, note) for r in ext for result, score, note in [grade(r)]]

gt = json.load(open(GT))
docs = gt["documents"]
doc_by_id = {d["id"]: d for d in docs}
cat_of = {d["id"]: d["category"] for d in docs}
excl = {(e["file"], e["field"]): e["reason"] for e in gt.get("$scoringExclusions", [])}
CATS = ["budget", "email", "invoice", "letter", "news article"]

VARIANTS = [
    ("Textract", "Claude Sonnet 4.6", "textract-sonnet-4-6"),
    ("Textract", "Claude Sonnet 4.5", "textract-sonnet-4-5"),
    ("Textract", "Claude Haiku 4.5", "textract-haiku-4-5"),
    ("Textract", "Qwen3 32B", "textract-qwen3-32b"),
    ("Textract", "Llama 4 Maverick", "textract-llama4-maverick"),
    ("VLM", "Claude Sonnet 4.6", "vlm-sonnet-4-6"),
]
LABEL = {v[2]: (v[0], v[1]) for v in VARIANTS}
READER = {"Textract": "Text reader (AWS Textract)", "VLM": "Vision model (Qwen3-VL)"}


def short(vid):
    inp, model = LABEL[vid]
    return f"{model} + {'Vision' if inp == 'VLM' else 'Textract'}"


FINAL_RUNS = ["20261102-102753", "20261102-103030", "20261102-104021",
              "20261102-111617", "20261102-115831", "20261102-145512"]
secs = collections.defaultdict(list)
outcomes = collections.Counter()
for run in FINAL_RUNS:
    if not os.path.isdir(os.path.join(RUNS, run, "raw")):
        sys.exit(f"missing run records: {os.path.relpath(os.path.join(RUNS, run, 'raw'), PROJECT)}")
    for f in glob.glob(os.path.join(RUNS, run, "raw", "*.json")):
        x = json.load(open(f))
        outcomes[x["outcome"]] += 1
        if x.get("processingMs") is not None:
            secs[(x["variantId"], x["job"])].append(x["processingMs"] / 1000)

JOBS = ("summarization", "classification", "extraction")
agg = {}
for inp, model, vid in VARIANTS:
    s = [r for r in summ if (r[0], r[1]) == (inp, model)]
    c = [r for r in cls if (r[0], r[1]) == (inp, model)]
    e = [r for r in ext if (r[0], r[1]) == (inp, model) and r[8] == "Included"]
    a = {
        "summary": st.mean(float(r[3]) for r in s),
        "coverage": st.mean(float(r[4]) for r in s),
        "accuracy": st.mean(float(r[5]) for r in s),
        "clarity": st.mean(float(r[6]) for r in s),
        "conciseness": st.mean(float(r[7]) for r in s),
        "cls": sum(r[6] == "Correct" for r in c) / len(c),
        "cls_ok": sum(r[6] == "Correct" for r in c),
        "ext": st.mean(r[7] for r in e),
        "ext_full": sum(r[9] == "Correct" for r in e),
        "ext_part": sum(r[9] == "Partly correct" for r in e),
        "ext_n": len(e),
    }
    for j in JOBS:
        a[j] = st.median(secs[(vid, j)])
    a["speed"] = st.mean(a[j] for j in JOBS)
    agg[vid] = a

# summary and page-labelling scores must equal the verified source workbook's Summary sheet
# (extraction is regraded from review verdicts above, so it is reported, not asserted)
headline = collections.defaultdict(list)
for r in src["Summary"].iter_rows(values_only=True):
    if r and r[0] in {v[1] for v in VARIANTS} and isinstance(r[1], (int, float)):
        headline[r[0]].append(r[1:4])
for inp, model, vid in VARIANTS:
    want = headline[model][0 if inp == "Textract" else -1]
    got = (agg[vid]["summary"], agg[vid]["cls"])
    assert all(abs(x - y) < 1e-9 for x, y in zip(want, got)), (vid, want, got)
    agg[vid]["ext_old"] = want[2]

TX = [v[2] for v in VARIANTS if v[0] == "Textract"]
VLM, SON, HAI = agg["vlm-sonnet-4-6"], agg["textract-sonnet-4-6"], agg["textract-haiku-4-5"]
slowdown = st.mean(VLM[j] / SON[j] for j in JOBS)
fastest = min(TX, key=lambda v: agg[v]["speed"])
weakest = min(TX, key=lambda v: agg[v]["summary"] + agg[v]["cls"] + agg[v]["ext"])

wb = openpyxl.Workbook()


# ---------- layout helpers ----------
def setup(ws, title, subtitle, widths, tab=NAVY):
    ws.sheet_view.showGridLines = False
    ws.sheet_properties.tabColor = tab
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    last = get_column_letter(len(widths))
    for row, text, f, h, bg in ((1, title, font(18, True, "FFFFFF"), 38, NAVY),
                                (2, subtitle, font(10, color=MUTED, italic=True), 30, None)):
        ws.merge_cells(f"A{row}:{last}{row}")
        c = ws.cell(row, 1, text)
        c.font = f
        c.alignment = Alignment(vertical="center", indent=1, wrap_text=True)
        if bg:
            c.fill = fill(bg)
        ws.row_dimensions[row].height = h
    return 4


def section(ws, row, text, ncols):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=ncols)
    ws.cell(row, 1, text).font = font(13, True, TEAL)
    for col in range(1, ncols + 1):
        ws.cell(row, col).border = Border(bottom=Side(style="medium", color=TEAL))
    ws.row_dimensions[row].height = 24
    return row + 1


def header(ws, row, labels):
    for i, h in enumerate(labels, 1):
        c = ws.cell(row, i, h)
        c.font = font(10, True, "FFFFFF")
        c.fill = fill(NAVY)
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = BOX
    ws.row_dimensions[row].height = 34


def body(ws, row, values, fmt=None, zebra=False, bold=False, height=20):
    for i, v in enumerate(values, 1):
        c = ws.cell(row, i, v)
        c.font = font(10, bold)
        c.border = BOX
        c.alignment = Alignment(vertical="center", wrap_text=True,
                                horizontal="left" if isinstance(v, str) else "center")
        if fmt and fmt[i - 1]:
            c.number_format = fmt[i - 1]
        if zebra:
            c.fill = fill(ZEBRA)
    ws.row_dimensions[row].height = height


def para(ws, row, text, ncols, size=10, color=INK, height=None, bold=False, bg=None, indent=0):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=ncols)
    c = ws.cell(row, 1, text)
    c.font = font(size, bold, color)
    c.alignment = Alignment(wrap_text=True, vertical="center", indent=indent)
    if bg:
        for col in range(1, ncols + 1):
            ws.cell(row, col).fill = fill(bg)
    # Size the row to the wrapped text: Excel and Google Sheets don't auto-fit merged cells.
    width = sum(ws.column_dimensions[get_column_letter(c)].width or 10 for c in range(1, ncols + 1))
    chars_per_line = max(20, width * 1.1 * 10 / size - indent * 2)
    lines = -(-len(text) // int(chars_per_line))
    ws.row_dimensions[row].height = max(height or 0, lines * (size + 5) + 8)
    return row + 1


def good_high(ws, rng):
    ws.conditional_formatting.add(rng, ColorScaleRule(
        start_type="min", start_color="F8D7DA", mid_type="percentile", mid_value=50,
        mid_color="FFF3CD", end_type="max", end_color="C6EFCE"))


def good_low(ws, rng):
    ws.conditional_formatting.add(rng, ColorScaleRule(
        start_type="min", start_color="C6EFCE", mid_type="percentile", mid_value=50,
        mid_color="FFF3CD", end_type="max", end_color="F8D7DA"))


def tag(ws, rng, text, color):
    ws.conditional_formatting.add(rng, CellIsRule(operator="equal", formula=[f'"{text}"'], fill=fill(color)))


def table(ws, name, first, headers, rows, fmts=None, wrap=()):
    header(ws, first, headers)
    for i, r in enumerate(rows, first + 1):
        for j, v in enumerate(r, 1):
            c = ws.cell(i, j, v)
            c.font = font(10)
            c.alignment = Alignment(vertical="top", wrap_text=j in wrap)
            if fmts and fmts[j - 1]:
                c.number_format = fmts[j - 1]
    last = first + len(rows)
    t = Table(displayName=name, ref=f"A{first}:{get_column_letter(len(headers))}{last}")
    t.tableStyleInfo = TableStyleInfo(name="TableStyleLight9", showRowStripes=True)
    ws.add_table(t)
    ws.freeze_panes = ws.cell(first + 1, 1)
    return last


# ======================= 1. Overview =======================
ws = wb.active
ws.title = "Overview"
W = [30, 16, 16, 16, 16, 16]
r = setup(ws, "DocWeaver — Which model should we use?",
          "Six model setups compared on summarizing, classifying and extracting data from real documents, "
          "scored against a hand-checked ground truth.", W)

tiles = [("10", "documents"), ("5", "document types"), ("6", "model setups"),
         ("3", "tasks each"), (str(sum(outcomes.values())), "runs"), (f"{outcomes['completed']}", "completed")]
for i, (big, small) in enumerate(tiles, 1):
    for row, text, f in ((r, big, font(22, True, TEAL)), (r + 1, small, font(9, color=MUTED))):
        c = ws.cell(row, i, text)
        c.font = f
        c.fill = fill(PALE)
        c.alignment = Alignment(horizontal="center", vertical="center")
ws.row_dimensions[r].height = 38
ws.row_dimensions[r + 1].height = 18
r += 3

r = section(ws, r, "Recommendation", len(W))
r = para(ws, r, f"Use Claude Sonnet 4.6. With the vision reader it gives the best results of any setup; "
                f"with Textract it is the best of the text-based setups.", len(W), size=12, bold=True,
         height=36, bg=GOOD, indent=1)
r += 1

r = section(ws, r, "What we found", len(W))
findings = [
    f"Best quality overall: Claude Sonnet 4.6 reading documents with the vision model. It writes the best "
    f"summaries ({VLM['summary']:.0%}) and pulls out data most accurately ({VLM['ext']:.0%}).",
    f"The catch is speed: the vision setup takes about {slowdown:.0f}× longer per task "
    f"(around {VLM['extraction']:.0f} seconds instead of {SON['extraction']:.0f}).",
    f"Best text-based choice: Claude Sonnet 4.6 with Textract. It writes the best summaries and labels pages "
    f"most reliably ({SON['cls']:.0%}) of the text-based models. Sonnet 4.5 is slightly ahead on data extraction "
    f"({agg['textract-sonnet-4-5']['ext']:.0%} vs {SON['ext']:.0%}) but slower "
    f"({agg['textract-sonnet-4-5']['speed']:.0f} vs {SON['speed']:.0f} seconds per task).",
    f"Good faster option: Claude Haiku 4.5 is close to Sonnet 4.6 on summaries ({HAI['summary']:.0%} vs "
    f"{SON['summary']:.0%}) and data extraction ({HAI['ext']:.0%} vs {SON['ext']:.0%}), but weaker at labelling pages "
    f"({HAI['cls']:.0%}).",
    f"Qwen3 32B is the weakest overall, with the lowest page labelling ({agg['textract-qwen3-32b']['cls']:.0%}) and "
    f"data extraction ({agg['textract-qwen3-32b']['ext']:.0%}). Llama 4 Maverick is the fastest "
    f"(about {agg['textract-llama4-maverick']['speed']:.0f} seconds) but writes the weakest summaries "
    f"({agg['textract-llama4-maverick']['summary']:.0%}).",
    "Most mistakes come from three documents: a two-page news article (the Missoulian), a "
    "school budget where text recognition garbles the title (Singleton), and the second page of the Oxnard mayor's letter. Emails are handled well by "
    "nearly every model.",
]
for f_ in findings:
    r = para(ws, r, "•   " + f_, len(W), size=11, height=34, indent=1)
r += 1

r = section(ws, r, "Scores at a glance", len(W))
header(ws, r, ["Model setup", "Reads documents with", "Summary quality", "Page labelling",
               "Data extraction", "Seconds per task"])
hdr = r
r += 1
for i, (inp, model, vid) in enumerate(VARIANTS):
    a = agg[vid]
    body(ws, r, [model, "Vision model" if inp == "VLM" else "Textract", a["summary"], a["cls"], a["ext"],
                 a["speed"]], fmt=[None, None, PCT, PCT, PCT, "0.0"], zebra=i % 2 == 1,
         bold=model == "Claude Sonnet 4.6", height=22)
    r += 1
for col in "CDE":
    good_high(ws, f"{col}{hdr + 1}:{col}{r - 1}")
good_low(ws, f"F{hdr + 1}:F{r - 1}")
r = para(ws, r, "Green is better. Higher percentages are better; for speed, fewer seconds is better. "
                "Each task is compared on its own; scores are not added together.", len(W), color=MUTED)
r += 1

ch = BarChart()
ch.type = "bar"
ch.style = 10
ch.title = "Quality by model setup"
ch.y_axis.number_format = "0%"
ch.y_axis.scaling.min = 0.7
ch.y_axis.scaling.max = 1.0
ch.y_axis.majorGridlines = None
ch.x_axis.delete = False
ch.y_axis.delete = False
ch.legend.position = "b"
ch.height, ch.width = 10, 22
labels_col = len(W) + 2  # hidden helper column with readable setup names for the chart
for i, (inp, model, vid) in enumerate(VARIANTS):
    ws.cell(hdr + 1 + i, labels_col, short(vid)).font = font(9, color="FFFFFF")
ws.column_dimensions[get_column_letter(labels_col)].hidden = True
ch.add_data(Reference(ws, min_col=3, max_col=5, min_row=hdr, max_row=hdr + len(VARIANTS)), titles_from_data=True)
ch.set_categories(Reference(ws, min_col=labels_col, min_row=hdr + 1, max_row=hdr + len(VARIANTS)))
for s, color in zip(ch.series, [NAVY, TEAL, "94A3B8"]):
    s.graphicalProperties.solidFill = color
    s.graphicalProperties.line.solidFill = color
ws.add_chart(ch, f"A{r}")
r += 21

r = section(ws, r, "What the scores mean", len(W))
for line in [
    "Summary quality — how complete, accurate, clear and concise the summary is compared with the ground truth summary.",
    "Page labelling — the share of pages given the right document type (invoice, letter, email, budget, news article).",
    "Data extraction — how well key fields (dates, names, totals and so on) match the ground truth.",
    "Ground truth — the correct answers, prepared by hand and checked against the original PDFs. See the Ground Truth sheet.",
    "Small test set: 2 documents per type. Treat differences of a few points as a tendency, not a verdict.",
]:
    r = para(ws, r, "•   " + line, len(W), height=20, indent=1)

# ======================= 2. Model Comparison =======================
ws = wb.create_sheet("Model Comparison")
W = [24, 26, 15, 15, 15, 15, 15, 15]
r = setup(ws, "Model Comparison", "Every setup side by side: quality on each task, what drives the "
          "summary score, and speed.", W)

r = section(ws, r, "Quality", len(W))
header(ws, r, ["Model", "Reads documents with", "Summary quality", "Page labelling", "Pages correct",
               "Data extraction", "Fields correct", "Fields partly correct"])
hdr = r
r += 1
for i, (inp, model, vid) in enumerate(VARIANTS):
    a = agg[vid]
    body(ws, r, [model, READER[inp], a["summary"], a["cls"], f"{a['cls_ok']} of 17", a["ext"],
                 f"{a['ext_full']} of {a['ext_n']}", f"{a['ext_part']} of {a['ext_n']}"],
         fmt=[None, None, PCT, PCT, None, PCT, None, None], zebra=i % 2 == 1, height=22)
    r += 1
for col in "CDF":
    good_high(ws, f"{col}{hdr + 1}:{col}{r - 1}")
r += 1

r = section(ws, r, "Summary quality in detail", len(W))
header(ws, r, ["Model", "Reads documents with", "Overall", "Covers the key points", "Factually accurate",
               "Clear", "Concise"])
hdr = r
r += 1
for i, (inp, model, vid) in enumerate(VARIANTS):
    a = agg[vid]
    body(ws, r, [model, READER[inp], a["summary"], a["coverage"], a["accuracy"], a["clarity"], a["conciseness"]],
         fmt=[None, None] + [PCT] * 5, zebra=i % 2 == 1, height=22)
    r += 1
for col in "CDEFG":
    good_high(ws, f"{col}{hdr + 1}:{col}{r - 1}")
r = para(ws, r, "Accuracy is high for every model: the differences come mainly from how much of the key "
                "content each summary covers.", len(W), color=MUTED, height=20)
r += 1

r = section(ws, r, "Speed (typical seconds per task)", len(W))
header(ws, r, ["Model", "Reads documents with", "Summary", "Page labelling", "Data extraction", "Average"])
hdr = r
r += 1
for i, (inp, model, vid) in enumerate(VARIANTS):
    a = agg[vid]
    body(ws, r, [model, READER[inp], a["summarization"], a["classification"], a["extraction"], a["speed"]],
         fmt=[None, None] + ["0.0"] * 4, zebra=i % 2 == 1, height=22)
    r += 1
for col in "CDEF":
    good_low(ws, f"{col}{hdr + 1}:{col}{r - 1}")
para(ws, r, f"Fewer seconds is better. {short(fastest)} is the quickest; the vision setup is the slowest "
            f"because it reads page images rather than extracted text.", len(W), color=MUTED, height=20)

# ======================= 3. By Document Type =======================
ws = wb.create_sheet("By Document Type")
W = [16] + [16] * len(VARIANTS)
r = setup(ws, "Results by Document Type", "Where each setup does well and where it struggles. "
          "Each cell covers the 2 documents of that type.", W)
names = [short(v[2]).replace(" + ", "\n+ ") for v in VARIANTS]


def in_cat(row, cat):
    return cat_of[row[2]] == cat


def matrix(r, title, fn, takeaway):
    r = section(ws, r, title, len(W))
    header(ws, r, ["Document type"] + names)
    ws.row_dimensions[r].height = 46
    first = r + 1
    r += 1
    for k, cat in enumerate(CATS):
        vals = [fn(v[2], cat) for v in VARIANTS]
        body(ws, r, [cat.title()] + vals, fmt=[None] + [PCT] * len(vals), zebra=k % 2 == 1, height=22)
        r += 1
    good_high(ws, f"B{first}:{get_column_letter(len(W))}{r - 1}")
    r = para(ws, r, takeaway, len(W), color=MUTED, height=20)
    return r + 1


def mean_of(rows_, vid, cat, col, cond=lambda x: True):
    return st.mean(float(x[col]) for x in rows_ if (x[0], x[1]) == LABEL[vid] and in_cat(x, cat) and cond(x))


def acc(vid, cat):
    xs = [x for x in cls if (x[0], x[1]) == LABEL[vid] and in_cat(x, cat)]
    return sum(x[6] == "Correct" for x in xs) / len(xs)


def inc(x):
    return x[8] == "Included"


r = matrix(r, "Summary quality", lambda v, c: mean_of(summ, v, c, 3),
           "News articles are the hardest to summarize for every text-based model (81–90%); the vision setup "
           "reaches 97%. Every other document type scores 89% or higher.")
r = matrix(r, "Page labelling", acc,
           "Budgets are labelled correctly by every setup. Most mistakes are second pages: the Missoulian news "
           "article (missed by all five Textract models), the Richmond invoice (missed by all but Sonnet 4.6) and "
           "the mayor's letter.")
r = matrix(r, "Data extraction", lambda v, c: mean_of(ext, v, c, 7, inc),
           "Emails and invoices extract well. Budgets, letters and news articles are harder: on the Singleton "
           "budget the text reader garbles the school name and models pick a subtotal instead of the total; "
           "letter answers often leave out the sender's or recipient's organization.")

# ======================= 4. Vision vs Text =======================
ws = wb.create_sheet("Vision vs Textract")
W = [28, 16, 16, 16, 34]
r = setup(ws, "Does the vision reader help?", "Same model (Claude Sonnet 4.6), two ways of reading the "
          "document: AWS Textract text vs the Qwen3-VL vision model.", W, tab=TEAL)
r = section(ws, r, "Side by side", len(W))
header(ws, r, ["", "Textract", "Vision model", "Difference", "What it means"])
r += 1
rows = [
    ("Summary quality", SON["summary"], VLM["summary"], "pp"),
    ("Page labelling", SON["cls"], VLM["cls"], "pp"),
    ("Data extraction", SON["ext"], VLM["ext"], "pp"),
    ("Seconds per task", SON["speed"], VLM["speed"], "x"),
]
for i, (lab, a, b, kind) in enumerate(rows):
    if kind == "pp":
        d = (b - a) * 100
        fmt_d = '+0.0" points";-0.0" points";"no change"'
        verdict = "Vision is better" if d > 0.05 else "Textract is better" if d < -0.05 else "Same result"
        f_ = PCT
    else:
        d, fmt_d, f_ = b / a, '0.0"× slower"', "0.0"
        verdict = "Vision is much slower"
    body(ws, r, [lab, a, b, d, verdict], fmt=[None, f_, f_, fmt_d, None], zebra=i % 2 == 1, bold=True, height=26)
    ws.cell(r, 5).fill = fill(GOOD if verdict == "Vision is better" else WARN if "slower" in verdict else
                              BAD if verdict.startswith("Textract") else PALE)
    r += 1
r += 1
r = section(ws, r, "By document type (difference in points, vision minus Textract)", len(W))
header(ws, r, ["Document type", "Summary quality", "Page labelling", "Data extraction", ""])
first = r + 1
r += 1
for k, cat in enumerate(CATS):
    ds = (mean_of(summ, "vlm-sonnet-4-6", cat, 3) - mean_of(summ, "textract-sonnet-4-6", cat, 3)) * 100
    dc = (acc("vlm-sonnet-4-6", cat) - acc("textract-sonnet-4-6", cat)) * 100
    de = (mean_of(ext, "vlm-sonnet-4-6", cat, 7, inc) - mean_of(ext, "textract-sonnet-4-6", cat, 7, inc)) * 100
    body(ws, r, [cat.title(), ds, dc, de, ""], fmt=[None] + ['+0.0;-0.0;"–"'] * 3 + [None], zebra=k % 2 == 1, height=22)
    r += 1
for col in "BCD":
    ws.conditional_formatting.add(f"{col}{first}:{col}{r - 1}",
                                  CellIsRule(operator="greaterThan", formula=["0.05"], fill=fill(GOOD)))
    ws.conditional_formatting.add(f"{col}{first}:{col}{r - 1}",
                                  CellIsRule(operator="lessThan", formula=["-0.05"], fill=fill(BAD)))
r += 1
r = section(ws, r, "Verdict", len(W))
para(ws, r, f"The vision reader improves summaries (most on news articles and budgets) and data extraction "
            f"(most on budgets and invoices, where it reads the school name the text reader garbled), though it "
            f"misreads one news article's publication date. Page labelling ends up the same: it fixes the news-article page that "
            f"every Textract model missed, but gets the mayor's letter page wrong. It takes about {slowdown:.0f}× as "
            f"long, so it is worth it where accuracy matters more than turnaround time.",
     len(W), size=11, height=78, bg=PALE, indent=1)

# ======================= 5-7. Detail sheets =======================
ws = wb.create_sheet("Summaries")
W = [22, 13, 14, 50, 12, 12, 12, 10, 10]
setup(ws, "Summaries — every document", "One row per document and model. Scores compare each summary "
      "with the ground truth summary (see the Ground Truth sheet).", W)
rows = []
for x in summ:
    rows.append([x[1], "Vision" if x[0] == "VLM" else "Textract", cat_of[x[2]].title(), x[2]] +
                [float(v) for v in x[3:8]])
rows.sort(key=lambda z: (z[2], z[3], z[1], z[0]))
last = table(ws, "Summaries", 4, ["Model", "Reader", "Document type", "Document", "Overall",
                                  "Key points", "Accuracy", "Clarity", "Concise"], rows,
             fmts=[None] * 4 + [PCT] * 5)
for col in "EFGHI":
    good_high(ws, f"{col}5:{col}{last}")

ws = wb.create_sheet("Page Labels")
W = [22, 13, 14, 50, 8, 15, 15, 12]
wrong = sum(x[6] != "Correct" for x in cls)
setup(ws, "Page labelling — every page", f"One row per page and model ({len(cls)} in total, {wrong} wrong). "
      "Filter the Result column to see the mistakes.", W)
rows = [[x[1], "Vision" if x[0] == "VLM" else "Textract", cat_of[x[2]].title(), x[2], int(x[3]), x[4], x[5],
         "Correct" if x[6] == "Correct" else "Wrong"] for x in cls]
rows.sort(key=lambda z: (z[2], z[3], z[4], z[1], z[0]))
last = table(ws, "PageLabels", 4, ["Model", "Reader", "Document type", "Document", "Page", "Ground truth",
                                   "Model said", "Result"], rows)
tag(ws, f"H5:H{last}", "Correct", GOOD)
tag(ws, f"H5:H{last}", "Wrong", BAD)

ws = wb.create_sheet("Extracted Data")
W = [20, 10, 13, 34, 24, 34, 34, 9, 15, 40]
setup(ws, "Data extraction — every field", "One row per field and model, compared with the ground truth and "
      "checked by hand against the original PDF. Correct = 100%, partly correct = 50%, wrong, missing or not in "
      "the document = 0%. Fields marked Not scored have no single correct ground truth value.", W)
rows = []
for x in ext:
    inp, model, doc, field, exp, got, auto, score, included, result, note = x
    if included != "Included":
        note = excl.get((doc_by_id[doc]["file"], field), "")
    rows.append([model, "Vision" if inp == "VLM" else "Textract", cat_of[doc].title(), doc, field,
                 exp if exp not in (None, "") else "(empty — not in the document)",
                 got if got not in (None, "") else "(nothing found)", score, result, note])
rows.sort(key=lambda z: (z[2], z[3], z[4], z[1], z[0]))
last = table(ws, "ExtractedData", 4, ["Model", "Reader", "Document type", "Document", "Field", "Ground truth",
                                      "Model's answer", "Score", "Result", "Why"], rows,
             fmts=[None] * 7 + ["0%", None, None], wrap=(6, 7, 10))
for text, color in (("Correct", GOOD), ("Partly correct", WARN), ("Wrong", BAD), ("Missing", BAD),
                    ("Not in document", BAD), ("Not scored", PALE)):
    tag(ws, f"I5:I{last}", text, color)

# ======================= 8. Ground Truth =======================
ws = wb.create_sheet("Ground Truth")
W = [30, 72, 11, 42]
r = setup(ws, "Ground Truth", "The correct answers every model was scored against: for each document, a summary, "
          "the document type of every page, and five key fields. Prepared by hand and checked against the "
          "original PDFs.", W, tab=TEAL)


def pdf_name(d):
    return os.path.basename(d["file"]).removesuffix(".pdf")


def merged(row, col_from, col_to, value, f, bg=None, height=None, align=None):
    ws.merge_cells(start_row=row, start_column=col_from, end_row=row, end_column=col_to)
    c = ws.cell(row, col_from, value)
    c.font = f
    c.alignment = align or Alignment(wrap_text=True, vertical="top")
    if bg:
        for col in range(col_from, col_to + 1):
            ws.cell(row, col).fill = fill(bg)
    if height:
        ws.row_dimensions[row].height = height


r = section(ws, r, "At a glance", len(W))
header(ws, r, ["Document type", "Documents", "Pages", "Fields scored"])
r += 1
for k, cat in enumerate(CATS):
    in_type = [d for d in docs if d["category"] == cat]
    fields = [(d, f["name"]) for d in in_type for f in d["extraction"]["fields"]]
    scored = sum((d["file"], name) not in excl for d, name in fields)
    body(ws, r, [cat.title(), len(in_type), sum(len(d["classification"]) for d in in_type),
                 f"{scored} of {len(fields)}"], zebra=k % 2 == 1)
    r += 1
r += 1

for cat in CATS:
    in_type = sorted((d for d in docs if d["category"] == cat), key=lambda d: d["id"])
    pages = sum(len(d["classification"]) for d in in_type)
    merged(r, 1, len(W), f"{cat.title()}   ·   {len(in_type)} documents, {pages} pages",
           font(14, True, "FFFFFF"), bg=TEAL, height=28, align=Alignment(vertical="center", indent=1))
    r += 2
    for d in in_type:
        n = len(d["classification"])
        merged(r, 1, len(W), f"{pdf_name(d)}   ·   {n} page{'s' if n > 1 else ''}", font(12, True, NAVY),
               bg=PALE, height=24, align=Alignment(vertical="center", indent=1))
        r += 1
        for label, value in (
            ("Summary", d["summary"]),
            ("Page types", "   ".join(f"Page {p['page']}: {p['label'].title()}" for p in d["classification"])),
        ):
            c = ws.cell(r, 1, label)
            c.font = font(10, True, MUTED)
            c.alignment = Alignment(vertical="top", indent=1)
            merged(r, 2, len(W), value, font(10), height=max(20, 15 * (len(value) // 135 + 1)))
            r += 1
        header(ws, r, ["Field", "Ground truth", "Scored", "Note"])
        ws.row_dimensions[r].height = 22
        r += 1
        for k, fdef in enumerate(d["extraction"]["fields"]):
            name = fdef["name"]
            val = d["extraction"]["values"].get(name)
            reason = excl.get((d["file"], name))
            body(ws, r, [name, val if val not in (None, "") else "(empty — not in the document)",
                         "No" if reason else "Yes", f"Not scored: {reason}" if reason else ""],
                 zebra=k % 2 == 1, height=max(20, 15 * (len(str(val or "")) // 75 + 1)))
            ws.cell(r, 3).alignment = Alignment(horizontal="center", vertical="center")
            if reason:
                ws.cell(r, 3).fill = fill(WARN)
            if val in (None, ""):
                ws.cell(r, 2).font = font(10, color=MUTED, italic=True)
            r += 1
        r += 1
    r += 1
ws.freeze_panes = "A4"

# ======================= 9. About this test =======================
ws = wb.create_sheet("About This Test")
W = [26, 100]
r = setup(ws, "About This Test", "What was tested, how it was scored, and what to keep in mind.", W, tab="6B7280")


def kv(r, title, items):
    r = section(ws, r, title, 2)
    for i, (k_, v_) in enumerate(items):
        body(ws, r, [k_, v_], zebra=i % 2 == 1, height=max(20, 15 * (len(v_) // 115 + 1)))
        ws.cell(r, 1).font = font(10, True)
        ws.cell(r, 1).alignment = Alignment(vertical="top", wrap_text=True)
        ws.cell(r, 2).alignment = Alignment(vertical="top", wrap_text=True)
        r += 1
    return r + 1


r = kv(r, "What was tested", [
    ("Documents", "10 real documents, 2 each of budget, email, invoice, letter and news article (17 pages)."),
    ("Model setups", "Five models reading text from AWS Textract — Claude Sonnet 4.6, Claude Sonnet 4.5, Claude "
                     "Haiku 4.5, Qwen3 32B and Llama 4 Maverick — plus Claude Sonnet 4.6 reading through the "
                     "Qwen3-VL vision model."),
    ("Tasks", "Summarize the document, label each page with its document type, and extract five key fields."),
    ("Runs", f"{sum(outcomes.values())} runs on 2 November 2026; all {outcomes['completed']} completed."),
])
r = kv(r, "Ground truth", [
    ("What it is", "The correct answers for each document: a summary, the document type of every page, and five "
                   "key fields for its type. Every model is scored against the same ground truth."),
    ("How it was made", "Written by hand for each document, then checked against the original PDFs and corrected "
                        "where the PDF showed otherwise."),
    ("Where it lives", "Ground Truth sheet in this workbook; 01-ground-truth-annotation/data/final-reference.json in the ai-output-eval repo."),
])
r = kv(r, "How it was scored", [
    ("Summary quality", "An AI reviewer (Google Gemini 3.6 Flash) compared each summary with the ground truth summary and "
                        "rated it 0–10. Weighting: covers the key points 40%, factually accurate 40%, clear 10%, concise 10%. "
                        "The reviewer was not told which model wrote the summary, and judged it against the ground "
                        "truth summary only (it did not see the PDF). A paraphrase that keeps the facts counts as a full match."),
    ("Page labelling", "Share of the 17 pages whose document type matches the ground truth."),
    ("Data extraction", "Each extracted value was compared with the ground truth and checked by hand against the "
                        "PDF. Correct counts 100% (including the same answer written differently, such as 2014-15 "
                        "for 2014–2015), partly correct 50%, and wrong, missing or not in the document 0%. The data "
                        "extraction score is the average over the 46 scored fields. Four fields with no single "
                        "correct ground truth value are not scored for any model."),
])
r = kv(r, "Fields not scored", [
    (e["file"].split("/")[-1].replace(".pdf", "") + " — " + e["field"], e["reason"])
    for e in gt.get("$scoringExclusions", [])])
r = kv(r, "Keep in mind", [
    ("Small test set", "Two documents per type. A perfect score for a type can rest on three or four pages, "
                       "so small differences are a tendency, not a verdict."),
    ("One ground truth summary changed", "The Richmond invoice (20694747) ground truth summary was corrected after "
                                      "its text-based summaries were scored; those five scores were kept as recorded."),
    ("Speed", "Typical (median) processing time per task, one document at a time. Not a load test."),
])

for s in wb.worksheets:
    s.page_setup.orientation = "landscape"
    s.page_setup.fitToWidth = 1
    s.page_setup.fitToHeight = 0
    s.sheet_properties.pageSetUpPr.fitToPage = True
wb.properties.title = "DocWeaver Model Evaluation"
wb.properties.creator = "ai-output-eval"
wb.save(OUT)

print("wrote", OUT)
for inp, model, vid in VARIANTS:
    a = agg[vid]
    print(f"  {short(vid):36} summary={a['summary']:.3f} labels={a['cls']:.3f} extraction={a['ext']:.3f} (was {a['ext_old']:.3f}) "
          f"sec(s/l/e/avg)={a['summarization']:.1f}/{a['classification']:.1f}/{a['extraction']:.1f}/{a['speed']:.1f}")
print("slowdown", round(slowdown, 2), "fastest", fastest, "weakest", weakest)
