#!/usr/bin/env python3
"""
Compares two SQLite snapshots of the IdP database, before and after migrations.

Usage: compare.py <before.sqlite> <after.sqlite> <expectations.json>

For every table that exists before:
  - it must still exist after (unless listed in expectations.dropped_tables)
  - the row count must match
  - rows are matched by primary key; every column present on both sides must
    hold the same value, unless the change is listed in expectations.changes
Columns that disappear must be listed in expectations.dropped_columns.
Tables in expectations.skip_tables are not compared (e.g. d1_migrations).
New tables and columns are reported, not judged.

Exit 0 when everything matches the expectations, 1 otherwise.
"""
import json
import sqlite3
import sys


def tables(db):
    rows = db.execute(
        "select name from sqlite_master where type='table' "
        "and name not like 'sqlite_%' and name not like '_cf_%'"
    ).fetchall()
    return sorted(r[0] for r in rows)


def columns(db, table):
    return [(r[1], r[5]) for r in db.execute(f'pragma table_info("{table}")')]


def rows_by_key(db, table, cols):
    names = [c for c, _ in cols]
    pk = [c for c, k in sorted(cols, key=lambda c: c[1]) if k > 0] or ["rowid"]
    select = ", ".join(f'"{c}"' for c in names)
    out = {}
    for row in db.execute(f'select {select}{", rowid" if pk == ["rowid"] else ""} from "{table}"'):
        rec = dict(zip(names + (["rowid"] if pk == ["rowid"] else []), row))
        out[tuple(rec[k] for k in pk)] = rec
    return pk, out


def main(before_path, after_path, expectations_path):
    exp = json.load(open(expectations_path))
    dropped_tables = set(exp.get("dropped_tables", []))
    dropped_cols = {(t, c) for t, cs in exp.get("dropped_columns", {}).items() for c in cs}
    # {"table": {"column": {"<pk value>": [old, new]}}}
    changes = exp.get("changes", {})
    skip = set(exp.get("skip_tables", []))
    ignore = {(t, c) for t, cs in exp.get("ignore_columns", {}).items() for c in cs}

    before = sqlite3.connect(before_path)
    after = sqlite3.connect(after_path)
    failures, notes = [], []

    b_tables, a_tables = tables(before), set(tables(after))
    for t in sorted(a_tables - set(b_tables)):
        count = after.execute(f'select count(*) from "{t}"').fetchone()[0]
        notes.append(f"new table {t} ({count} rows)")

    for t in b_tables:
        if t in skip:
            notes.append(f"{t}: skipped")
            continue
        if t not in a_tables:
            (notes if t in dropped_tables else failures).append(f"table {t} dropped")
            continue
        b_cols, a_cols = columns(before, t), columns(after, t)
        a_names = {c for c, _ in a_cols}
        for c, _ in b_cols:
            if c not in a_names:
                (notes if (t, c) in dropped_cols else failures).append(f"column {t}.{c} dropped")
        for c in sorted(a_names - {c for c, _ in b_cols}):
            notes.append(f"new column {t}.{c}")

        shared = [(c, k) for c, k in b_cols if c in a_names and (t, c) not in ignore]
        pk, b_rows = rows_by_key(before, t, shared)
        _, a_rows = rows_by_key(after, t, shared)
        if len(b_rows) != len(a_rows):
            failures.append(f"{t}: {len(b_rows)} rows before, {len(a_rows)} after")
        missing = set(b_rows) - set(a_rows)
        if missing:
            failures.append(f"{t}: {len(missing)} rows lost, e.g. {sorted(missing)[:3]}")
        changed = 0
        for key in set(b_rows) & set(a_rows):
            for c, _ in shared:
                old, new = b_rows[key][c], a_rows[key][c]
                if old == new:
                    continue
                expected = changes.get(t, {}).get(c, {}).get(str(key[0]) if len(key) == 1 else str(key))
                if expected == [old, new]:
                    notes.append(f"expected change {t}.{c} {key}: {old!r} -> {new!r}")
                else:
                    changed += 1
                    if changed <= 5:
                        failures.append(f"{t}.{c} {key}: {old!r} -> {new!r}")
        if changed > 5:
            failures.append(f"{t}: {changed} unexpected value changes in total")
        notes.append(f"{t}: {len(a_rows)} rows checked")

    for line in notes:
        print("  ok  ", line)
    for line in failures:
        print("  FAIL", line)
    print(f"\n{'PASS' if not failures else 'FAIL'}: {len(failures)} problems")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:4]))
