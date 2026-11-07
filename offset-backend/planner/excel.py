from io import BytesIO

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

# Column titles we accept for the reference column (compared in lower case,
# so "References", "REFERENCES" and "REFFERANCE" all work).
HEADER_NAMES = {"references", "reference", "refferance", "refferances"}

# The header may sit below a title row (your Main sheet has its header in
# row 2), so we look through the first few rows.
MAX_HEADER_SEARCH_ROWS = 10


class ExcelReadError(Exception):
    """Raised with a message that is safe to show the user."""


def clean_name(value):
    """Trim the name and collapse repeated spaces (keeps the capitals)."""
    return " ".join(str(value).split())


def normalize_name(value):
    """
    Used only for MATCHING names: spaces collapsed AND lower case.
    'FG  _Calendar 2024' and 'fg _calendar 2024' become identical.
    """
    return " ".join(str(value).split()).casefold()


# ----------------------------------------------------------------------
# READ: pull the reference names out of an uploaded workbook
# ----------------------------------------------------------------------
def parse_reference_names(file):
    """Return the list of unique reference names found in the sheet."""
    try:
        # read_only is faster and uses less memory;
        # data_only gives values instead of formulas.
        wb = load_workbook(file, read_only=True, data_only=True)
    except Exception:
        raise ExcelReadError(
            "Could not read this file. Please upload a valid .xlsx workbook."
        )

    try:
        # Try every sheet in the workbook; use the first one with the header.
        for ws in wb.worksheets:
            col = None              # position of the reference column, once found
            names, seen = [], set()

            for row_number, row in enumerate(ws.iter_rows(values_only=True), start=1):
                if col is None:
                    # Still looking for the header row.
                    if row_number > MAX_HEADER_SEARCH_ROWS:
                        break       # no header in this sheet, try the next one
                    for index, cell in enumerate(row):
                        if cell is not None and str(cell).strip().casefold() in HEADER_NAMES:
                            col = index
                            break
                    continue        # this row was the header (or above it)

                # Below the header: collect names, skipping blanks and duplicates.
                if col >= len(row) or row[col] is None:
                    continue
                name = clean_name(row[col])
                key = name.casefold()
                if name and key not in seen:
                    seen.add(key)
                    names.append(name)

            if col is not None:
                if not names:
                    raise ExcelReadError("The 'References' column is empty.")
                return names

        raise ExcelReadError(
            "Could not find a column headed 'References' in the first "
            f"{MAX_HEADER_SEARCH_ROWS} rows of any sheet."
        )
    finally:
        wb.close()


# ----------------------------------------------------------------------
# WRITE: build the Excel file for the Job plans download
# ----------------------------------------------------------------------
# (title, column width, how to get the value from a Job, Excel number format)
JOB_COLUMNS = [
    ("Date",              12, lambda j: j.date,              "DD/MM/YYYY"),
    ("Reference",         48, lambda j: j.reference_name,    None),
    ("UPs",                8, lambda j: j.ups,               "#,##0"),
    ("Colours",           10, lambda j: j.colours,           "#,##0"),
    ("Sides",              8, lambda j: j.sides,             "#,##0"),
    ("Quantity",          12, lambda j: j.quantity,          "#,##0"),
    ("Machine",           14, lambda j: j.machine,           None),
    ("Impressions",       14, lambda j: j.impressions,       "#,##0"),
    ("Total impressions", 18, lambda j: j.total_impressions, "#,##0"),
    ("Total clicks",      14, lambda j: j.total_clicks,      "#,##0"),
    ("Saved by",          14, lambda j: j.created_by.username if j.created_by else "", None),
]


def build_jobs_workbook(jobs):
    """Return the bytes of an .xlsx file containing the given jobs."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Job plans"

    # Header row styled to match the app: gold background, umber text.
    header_fill = PatternFill("solid", start_color="D4A72C")
    header_font = Font(bold=True, color="2B2112")

    for col, (title, width, _getter, _fmt) in enumerate(JOB_COLUMNS, start=1):
        cell = ws.cell(row=1, column=col, value=title)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")
        ws.column_dimensions[get_column_letter(col)].width = width

    # One row per job, starting under the header (row 2).
    for row, job in enumerate(jobs, start=2):
        for col, (_title, _width, getter, fmt) in enumerate(JOB_COLUMNS, start=1):
            cell = ws.cell(row=row, column=col, value=getter(job))
            if fmt:
                cell.number_format = fmt

    ws.freeze_panes = "A2"              # header stays visible when scrolling
    ws.auto_filter.ref = ws.dimensions  # filter arrows on the header

    buffer = BytesIO()
    wb.save(buffer)
    return buffer.getvalue()