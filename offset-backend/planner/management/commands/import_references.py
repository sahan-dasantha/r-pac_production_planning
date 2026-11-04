import pandas as pd
from django.core.management.base import BaseCommand

from planner.models import Reference

COLS = {"ups": "UP PLAN", "colours": "NO OF COLOURS", "sides": "NO OF SIDES"}


class Command(BaseCommand):
    help = "Import unique references (UPs, colours, sides) from the Main Sheet"

    def add_arguments(self, parser):
        parser.add_argument("path")
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, path, dry_run, **opts):
        df = pd.read_excel(path, header=1)
        df.columns = [str(c).strip() for c in df.columns]
        df = df.dropna(subset=["REFFERANCE", *COLS.values()])
        df["REFFERANCE"] = df["REFFERANCE"].astype(str).map(lambda s: " ".join(s.split()))

        created = updated = 0
        for name, g in df.groupby("REFFERANCE"):
            last = g.iloc[-1]  # if rows disagree, the latest row wins
            values = {f: int(last[c]) for f, c in COLS.items()}

            for f, c in COLS.items():
                if g[c].nunique() > 1:
                    self.stdout.write(self.style.WARNING(
                        f"CONFLICT {name}: {c} = {sorted(g[c].unique())}, using {values[f]}"
                    ))
            if values["ups"] > 200:
                self.stdout.write(self.style.WARNING(
                    f"CHECK {name}: UP = {values['ups']} looks unusual"
                ))

            modes = g["MACHINE"].dropna().mode()
            values["default_machine"] = str(modes.iloc[0]) if len(modes) else ""

            if dry_run:
                continue
            _, was_created = Reference.objects.update_or_create(
                name=name, defaults=values
            )
            created += was_created
            updated += not was_created

        total = df["REFFERANCE"].nunique()
        self.stdout.write(self.style.SUCCESS(
            f"{total} unique references found. Created {created}, updated {updated}."
            + (" (dry run, nothing saved)" if dry_run else "")
        ))