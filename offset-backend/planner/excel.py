"""Excel reading (the upload) and writing (the Job plans download)."""
import re
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from io import BytesIO

from openpyxl import Workbook, load_workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from django.utils import timezone

MAX_HEADER_SEARCH_ROWS = 10   # your sheets have a title row above the header
MAX_ERRORS_SHOWN = 50         # show the first 50 problems, count the rest
MAX_INT = 2_000_000_000


class ExcelReadError(Exception):
    """Raised with a message that is safe to show the user."""


class SheetValidationError(ExcelReadError):
    """The sheet was read, but some rows have problems. Carries every problem."""

    def __init__(self, errors):
        self.total = len(errors)
        self.errors = errors[:MAX_ERRORS_SHOWN]
        super().__init__(
            f"{self.total} problem{'s' if self.total != 1 else ''} found in the sheet. "
            "Nothing was uploaded. Fix the rows below and upload again."
        )


def clean_name(value):
    """Trim and collapse repeated spaces (keeps the capitals)."""
    return " ".join(str(value).split())


def normalize_name(value):
    """For MATCHING names only: spaces collapsed and case ignored."""
    return " ".join(str(value).split()).casefold()


# ----------------------------------------------------------------------
# READ
# ----------------------------------------------------------------------
# These columns MUST be in the sheet.
REQUIRED_LABELS = {
    "so_number": "SO number",
    "reference": "Reference",
    "order_type": "Order type",
    "customer": "Customer",
    "noc": "Number of changes",
    "order_place_date": "Order place date",
    "quantity": "Quantity",
    "value": "Value",
}
# These columns are OPTIONAL. If the sheet has them they are stored and shown
# on the Job plans tab; if not, the upload still works.
OPTIONAL_LABELS = {
    "current_stage": "Current stage",
    "docket_stage": "Docket stage",
    "fg": "FG",
    "hold_status": "Hold/Unhold",
}
LABELS = {**REQUIRED_LABELS, **OPTIONAL_LABELS}

# Accepted header spellings (compared in lower case, punctuation ignored).
# "New S/O Nu", "REFFERANCE" and "CUSTOMER " from your own sheets all work.
HEADER_ALIASES = {
    "so_number": {"so number", "new so nu", "new so number", "so no", "so",
                  "sales order", "sales order number", "sales order no"},
    "reference": {"reference", "references", "refferance", "refferances",
                  "reference number", "reference no", "ref", "ref no"},
    "order_type": {"order type", "ordertype"},
    "customer": {"customer", "customer name"},
    "noc": {"noc", "number of changes", "no of changes", "changes"},
    "order_place_date": {"order place date", "order placed date",
                         "order date", "place date"},
    "quantity": {"quantity", "qty"},
    "value": {"value", "order value"},
    # optional
    "current_stage": {"current stage", "stage", "current status"},
    "docket_stage": {"docket stage", "docket status"},
    "fg": {"fg", "finished goods", "finished good", "fg qty", "fg quantity"},
    # "Hold/Unhold" becomes "holdunhold" once the punctuation is removed
    "hold_status": {"hold unhold", "holdunhold", "hold status", "hold"},
}
ALIAS_TO_FIELD = {a: f for f, names in HEADER_ALIASES.items() for a in names}


def header_key(cell):
    text = re.sub(r"[^a-z0-9 ]", "", str(cell).casefold())
    return " ".join(text.split())


def match_header(row):
    """If this row looks like the header, return {field: column index}."""
    found = {}
    for index, cell in enumerate(row):
        if cell is None:
            continue
        field = ALIAS_TO_FIELD.get(header_key(cell))
        if field and field not in found:
            found[field] = index
    return found if len(found) >= 3 else None


def is_blank(value):
    return value is None or (isinstance(value, str) and not value.strip())


def to_text(value):
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return clean_name(value)


def to_int(value):
    """A whole number from a cell, or None. Accepts 5, 5.0 and '1,500'."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    try:
        number = Decimal(str(value).replace(",", "").strip())
    except InvalidOperation:
        return None
    if not number.is_finite() or number != number.to_integral_value():
        return None
    return int(number)


def to_decimal(value):
    if isinstance(value, bool):
        return None
    try:
        number = Decimal(str(value).replace(",", "").strip())
    except InvalidOperation:
        return None
    if not number.is_finite() or abs(number) >= Decimal(10) ** 12:
        return None
    return number.quantize(Decimal("0.01"))


DATE_FORMATS = ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d.%m.%Y", "%d/%m/%y")


def to_date(value):
    result = None
    if isinstance(value, datetime):
        result = value.date()
    elif isinstance(value, date):
        result = value
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        if 20000 < value < 80000:  # an Excel serial date
            result = date(1899, 12, 30) + timedelta(days=int(value))
    elif isinstance(value, str):
        for fmt in DATE_FORMATS:
            try:
                result = datetime.strptime(value.strip(), fmt).date()
                break
            except ValueError:
                continue
    if result is None or not (2000 <= result.year <= 2100):
        return None
    return result


def validate_rows(columns, rows):
    """Check every row. Returns the clean orders, or raises with ALL problems."""
    orders, errors, seen = [], [], {}

    def cell(row, field):
        i = columns[field]
        return row[i] if i < len(row) else None

    for row_number, row in rows:
        before = len(errors)

        def bad(field, message):
            errors.append({"row": row_number, "column": LABELS[field], "message": message})

        def text_field(field, max_len):
            raw = cell(row, field)
            if is_blank(raw):
                bad(field, "is empty")
                return None
            text = to_text(raw)
            if len(text) > max_len:
                bad(field, f"is too long (maximum {max_len} characters)")
                return None
            return text

        so = text_field("so_number", 50)
        if so:
            key = so.casefold()
            if key in seen:
                bad("so_number", f"'{so}' is repeated (first seen in row {seen[key]})")
            else:
                seen[key] = row_number

        reference = text_field("reference", 255)
        order_type = text_field("order_type", 100)
        customer = text_field("customer", 255)

        raw = cell(row, "noc")
        noc = 0
        if not is_blank(raw):
            noc = to_int(raw)
            if noc is None or noc < 0:
                bad("noc", "must be a whole number (0 or more)")

        raw = cell(row, "order_place_date")
        placed = None
        if is_blank(raw):
            bad("order_place_date", "is empty")
        else:
            placed = to_date(raw)
            if placed is None:
                bad("order_place_date", "is not a valid date (use DD/MM/YYYY)")

        raw = cell(row, "quantity")
        quantity = None
        if is_blank(raw):
            bad("quantity", "is empty")
        else:
            quantity = to_int(raw)
            if quantity is None or quantity < 1 or quantity > MAX_INT:
                bad("quantity", "must be a whole number of 1 or more")

        raw = cell(row, "value")
        value = None
        if is_blank(raw):
            bad("value", "is empty")
        else:
            value = to_decimal(raw)
            if value is None or value < 0:
                bad("value", "must be a number (0 or more)")

        # ---- optional columns: only read them when the sheet has them ----
        optional = {}
        for field in ("current_stage", "docket_stage", "hold_status"):
            if field in columns:
                raw = cell(row, field)
                text = "" if is_blank(raw) else to_text(raw)
                if len(text) > 100:
                    bad(field, "is too long (maximum 100 characters)")
                else:
                    optional[field] = text
        if "fg" in columns:
            raw = cell(row, "fg")
            if is_blank(raw):
                optional["fg"] = None  # unknown
            else:
                fg = to_int(raw)
                if fg is None or fg < 0 or fg > MAX_INT:
                    bad("fg", "must be a whole number (0 or more)")
                else:
                    optional["fg"] = fg

        if len(errors) == before:
            orders.append({
                "row": row_number, "so_number": so, "reference_name": reference,
                "order_type": order_type, "customer": customer, "noc": noc,
                "order_place_date": placed, "quantity": quantity, "value": value,
                **optional,
            })

    if errors:
        raise SheetValidationError(errors)
    if not orders:
        raise ExcelReadError("The sheet has a header row but no orders below it.")
    return orders


def parse_sales_orders(file):
    """Read an uploaded workbook. Returns a list of clean order dicts."""
    try:
        wb = load_workbook(file, read_only=True, data_only=True)
    except Exception:
        raise ExcelReadError("Could not read this file. Please upload a valid .xlsx workbook.")

    try:
        missing_report = None
        for ws in wb.worksheets:
            if hasattr(ws, "reset_dimensions"):
                ws.reset_dimensions()  # some exports store a wrong sheet size
            columns, rows = None, []
            for row_number, row in enumerate(ws.iter_rows(values_only=True), start=1):
                if columns is None:
                    if row_number > MAX_HEADER_SEARCH_ROWS:
                        break
                    columns = match_header(row)
                    continue
                if all(is_blank(c) for c in row):
                    continue
                rows.append((row_number, row))
            if columns is None:
                continue
            missing = [REQUIRED_LABELS[f] for f in REQUIRED_LABELS if f not in columns]
            if missing:
                missing_report = missing
                continue
            return validate_rows(columns, rows)

        if missing_report:
            raise ExcelReadError("These columns are missing: " + ", ".join(missing_report) + ".")
        raise ExcelReadError(
            "Could not find the column headings in the first "
            f"{MAX_HEADER_SEARCH_ROWS} rows. Expected: " + ", ".join(REQUIRED_LABELS.values()) + "."
        )
    finally:
        wb.close()


# ----------------------------------------------------------------------
# WRITE: the Job plans download, with real Excel formulas
# ----------------------------------------------------------------------
FONT = "Arial"
HEADER_FILL = PatternFill("solid", start_color="D4A72C")  # gold, as in the app
HEADER_FONT = Font(name=FONT, bold=True, color="2B2112")  # umber

def _updated_date(job):
    """The day the plan was last saved (in the server's local time zone)."""
    moment = job.updated_at
    if timezone.is_aware(moment):
        moment = timezone.localtime(moment)
    return moment.date()


# (key, title, column width, number format)
# The same columns, in the same order, as the table on the Job plans tab.
COLUMNS = [
    ("updated", "Last updated date", 16, "DD/MM/YYYY"),
    ("current_stage", "Current Stage", 18, None),
    ("docket_stage", "Docket Stage", 18, None),
    ("so_number", "SO Number", 14, None),
    ("order_type", "Order Type", 20, None),
    ("quantity", "Quantity", 12, "#,##0"),
    ("fg", "FG", 12, "#,##0"),
    ("balance", "Balance", 12, "#,##0"),
    ("noc", "NOC", 10, "#,##0"),
    ("reference", "References", 46, None),
    ("customer", "Customer", 30, None),
    ("order_place_date", "Order Place", 14, "DD/MM/YYYY"),
    ("value", "Value", 14, "#,##0.00"),
    ("impressions", "Impression", 14, "#,##0"),
    ("total_impressions", "Total Impression", 18, "#,##0"),
    ("ups", "UP Plan", 10, "#,##0"),
    ("colours", "No of Colours", 14, "#,##0"),
    ("sides", "No of Sides", 12, "#,##0"),
    ("total_clicks", "Total Clicks", 14, "#,##0"),
    ("machine", "Machine", 14, None),
    ("hold_status", "Hold/Unhold", 14, None),
]

GETTERS = {
    "updated": _updated_date,
    "current_stage": lambda j: j.sales_order.current_stage,
    "docket_stage": lambda j: j.sales_order.docket_stage,
    "so_number": lambda j: j.sales_order.so_number,
    "order_type": lambda j: j.sales_order.order_type,
    "quantity": lambda j: j.quantity,
    "fg": lambda j: j.sales_order.fg,  # empty cell when unknown
    "noc": lambda j: j.sales_order.noc,
    "reference": lambda j: j.reference_name,
    "customer": lambda j: j.sales_order.customer,
    "order_place_date": lambda j: j.sales_order.order_place_date,
    "value": lambda j: float(j.sales_order.value),
    "ups": lambda j: j.ups,
    "colours": lambda j: j.colours,
    "sides": lambda j: j.sides,
    "machine": lambda j: j.machine,
    "hold_status": lambda j: j.sales_order.hold_status,
}

# The relations between the columns, written as real Excel formulas.
# {quantity} etc. become column letters, {r} the row number.
FORMULAS = {
    "balance": '=IF({fg}{r}="","",{quantity}{r}-{fg}{r})',
    "impressions": "=ROUNDUP({quantity}{r}/{ups}{r},0)",
    "total_impressions": "={impressions}{r}*{sides}{r}",
    "total_clicks": "={total_impressions}{r}*{colours}{r}",
}


def build_jobs_workbook(jobs):
    """Return the bytes of an .xlsx file containing the given jobs."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Job plans"
    letters = {key: get_column_letter(i) for i, (key, *_rest) in enumerate(COLUMNS, start=1)}

    for col, (key, title, width, _fmt) in enumerate(COLUMNS, start=1):
        cell = ws.cell(row=1, column=col, value=title)
        cell.fill, cell.font = HEADER_FILL, HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.column_dimensions[get_column_letter(col)].width = width
    ws[f"{letters['impressions']}1"].comment = Comment("Quantity ÷ UPs, rounded up", "Offset Planner")
    ws[f"{letters['total_impressions']}1"].comment = Comment("Impressions × Sides", "Offset Planner")
    ws[f"{letters['total_clicks']}1"].comment = Comment("Total impressions × Colours", "Offset Planner")

    last = 1
    for number, job in enumerate(jobs, start=1):
        last = number + 1
        for col, (key, _title, _width, fmt) in enumerate(COLUMNS, start=1):
            if key in FORMULAS:
                value = FORMULAS[key].format(r=last, **letters)
            else:
                value = GETTERS[key](job)
            cell = ws.cell(row=last, column=col, value=value)
            cell.font = Font(name=FONT)
            if fmt:
                cell.number_format = fmt

    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(COLUMNS))}{max(last, 2)}"

    buffer = BytesIO()
    wb.save(buffer)
    return buffer.getvalue()