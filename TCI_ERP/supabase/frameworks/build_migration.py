#!/usr/bin/env python3
"""Write a migration that loads framework documents.

    python3 supabase/frameworks/validate.py supabase/frameworks/RU_RAS.json
    python3 supabase/frameworks/build_migration.py 0052_my_change RU_RAS [MORE ...]

Each document becomes one `select tci.seed_statement_framework($fw$ … $fw$::jsonb)`
(see migration 0049). The loader is idempotent and never removes or re-keys a
line, so re-loading a corrected document is how a template is fixed. Add the
What/Why header by hand before committing.
"""

import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent


def main() -> None:
    name, codes = sys.argv[1], sys.argv[2:]
    if not codes:
        sys.exit(__doc__)
    parts = ['-- What: <say what changes>\n-- Why:  <say why>\n']
    for code in codes:
        doc = json.loads((HERE / f'{code}.json').read_text(encoding='utf-8'))
        body = json.dumps(doc, ensure_ascii=False, separators=(',', ':'))
        if '$fw$' in body:
            sys.exit(f'{code}: the document contains the $fw$ quote')
        parts.append(f"-- {code}: {doc['framework']['name']['en']}\n"
                     f"select tci.seed_statement_framework($fw${body}$fw$::jsonb);\n")
    out = HERE.parent / 'migrations' / f'{name}.sql'
    out.write_text('\n'.join(parts), encoding='utf-8')
    print(out)


if __name__ == '__main__':
    main()
