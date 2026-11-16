"""
One-time (or repeatable) import of the Main Sheet references from your old
planning sheet, e.g.:

    python manage.py import_references "OFFSET Main Sheet.xlsx" --dry-run
    python manage.py import_references "OFFSET Main Sheet.xlsx"

For every reference it takes UPs, colours, sides and machine from the sheet.
If a reference appears on several rows with different values, the LAST row
wins and the reference is listed as a conflict so you can check it.
Existing references are left alone unless you pass --overwrite.
"""
import re

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from openpyxl import load_workbook

from planner.excel import clean_name, header_key, normalize_name
from planner.models import MACHINES, Reference, ReferenceHistory

ALIASES = {
    "reference": {"reference", "references", "refferance", "refferances"},
    "ups": {"up plan", "ups", "up", "no of ups", "number of ups"},
    "colours": {"no of colours", "colours", "colors", "colour", "color", "number of colours"},
    "sides": {"no of sides", "sides", "side", "number of sides"},
    "machine": {"machine", "machine name"},
}
ALIAS_TO_FIELD = {a: f for f, names in ALIASES.items() for a in names}


def compact(text):
    return re.sub(r"[\s\-]+", "", str(text)).casefold()


MACHINE_BY_COMPACT = {compact(m): m for m in MACHINES}


def positive_int(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return int(number) if number >= 1 and number == int(number) else None


class Command(BaseCommand):
    help = "Import Main Sheet references (UPs, colours, sides, machine) from an Excel file."

    def add_arguments(self, parser):
        parser.add_argument("path")
        parser.add_argument("--dry-run", action="store_true", help="show what would happen, save nothing")
        parser.add_argument("--overwrite", action="store_true", help="update references that already exist")

    def handle(self, *args, path, dry_run, overwrite, **options):
        try:
            wb = load_workbook(path, read_only=True, data_only=True)
        except Exception as e:
            raise CommandError(f"Cannot read {path}: {e}")

        ws = wb.worksheets[0]
        if hasattr(ws, "reset_dimensions"):
            ws.reset_dimensions()
        columns, seen = None, {}   # seen: reference -> {"values": (...), "machine": ..., "variants": set()}
        for number, row in enumerate(ws.iter_rows(values_only=True), start=1):
            if columns is None:
                if number > 10:
                    raise CommandError("Could not find the header row (Reference, UP, colours, sides).")
                found = {}
                for i, cell in enumerate(row):
                    field = ALIAS_TO_FIELD.get(header_key(cell)) if cell is not None else None
                    if field and field not in found:
                        found[field] = i
                if {"reference", "ups", "colours", "sides"} <= set(found):
                    columns = found
                continue

            def get(field):
                i = columns.get(field)
                return row[i] if i is not None and i < len(row) else None

            if get("reference") is None:
                continue
            name = clean_name(get("reference"))
            values = (positive_int(get("ups")), positive_int(get("colours")), positive_int(get("sides")))
            if None in values:
                continue  # a row without a finished plan: nothing to learn from it
            machine = MACHINE_BY_COMPACT.get(compact(get("machine"))) if get("machine") else None
            entry = seen.setdefault(normalize_name(name), {"name": name, "variants": set()})
            entry.update(values=values, machine=machine or entry.get("machine", ""))
            entry["variants"].add(values)
        wb.close()

        existing = {normalize_name(r.name): r for r in Reference.objects.all()}
        created = updated = skipped = 0
        conflicts = []
        with transaction.atomic():
            for key, e in seen.items():
                if len(e["variants"]) > 1:
                    conflicts.append(e)
                ups, colours, sides = e["values"]
                ref = existing.get(key)
                if ref and not overwrite:
                    skipped += 1
                    continue
                if dry_run:
                    created, updated = created + (ref is None), updated + (ref is not None)
                    continue
                if ref:
                    ref.ups, ref.colours, ref.sides = ups, colours, sides
                    ref.default_machine = e["machine"] or ref.default_machine
                    ref.save()
                    updated += 1
                else:
                    ref = Reference.objects.create(name=e["name"], ups=ups, colours=colours,
                                                   sides=sides, default_machine=e["machine"])
                    ReferenceHistory.objects.create(
                        reference=ref, changes={"created": True, "source": "import"})
                    created += 1

        self.stdout.write(self.style.SUCCESS(
            f"{'[dry run] ' if dry_run else ''}{len(seen)} references found: "
            f"{created} created, {updated} updated, {skipped} skipped (already exist)."))
        if conflicts:
            self.stdout.write(self.style.WARNING(
                f"\n{len(conflicts)} reference(s) appear with different UPs/colours/sides. "
                "The LAST row was used. Please check these:"))
            for e in conflicts:
                shown = "  |  ".join(f"UPs {u}, colours {c}, sides {s}" for u, c, s in sorted(e["variants"]))
                self.stdout.write(f"  {e['name']}\n      {shown}   (used: UPs {e['values'][0]}, "
                                  f"colours {e['values'][1]}, sides {e['values'][2]})")