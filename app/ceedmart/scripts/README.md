# Backend scripts

## `yarn verify:schema`

Applies every migration to an empty database, then writes, reads back and
deletes one row for each of the 39 models across all 17 custom modules.

```
Server:   localhost:5433
Scratch:  ceedmart_schema_verify
(the real database, ceedmart, is not touched)

── Applying migrations ──
...
── Writing one row per model ──
  ok  audit.AuditEvent
  ok  terms.TermsDocument
  ...
39 passed, 0 failed of 39 models
```

Exits non-zero on any failure, so it can gate a deploy.

### Why it exists

Migrations and models are two hand-written descriptions of the same tables,
and nothing in `tsc`, `jest` or `medusa build` compares them. Three
mismatches reached production:

| Bug | Symptom |
|---|---|
| `raw_<field>` companion columns for `model.bigNumber()` written as `<field>_raw` | every insert fails with `column "raw_x" ... does not exist` |
| Model name derives a table name the migration did not create | `relation "qa_check" does not exist` |
| A field on the model that no migration ever added | `column "x" ... does not exist` |

Each is a hard error on the first insert and invisible until then.
`commission_entry` carried the first from the day M3 shipped: the subscriber
caught the error and logged it, so partner commission accrued nothing —
quietly, for months.

All three are verified to fail this script. Reintroduce one and it reports
the same error text production did.

### Why a fresh database

The dev database has been patched by hand over months, so it can pass while
a clean checkout — and the next production deploy — fails. Migrating from
empty is the whole point; running against an existing database proves
nothing.

### Adding a model

Add an entry to `CHECKS` in `src/scripts/verify-schema.ts` with the smallest
row the model accepts, and list the fields worth reading back in `verify`.
Always include `bigNumber` fields there: they are the ones with a companion
`raw_` column, and a value that writes but reads back wrong means that
column is mis-wired.

A model with no entry is not checked, and the count in the summary is the
only thing that says so — so add the entry in the same commit as the model.

### Where the scratch database lives

Same server and credentials as `DATABASE_URL`, different database name
(`ceedmart_schema_verify`; override with `SCHEMA_VERIFY_DB`). It is created
at the start and dropped at the end, including after a failure.

Two independent things keep it away from the real database: the wrapper only
ever names the scratch database, and `verify-schema.ts` asks the connection
which database it actually landed in and refuses anything whose name does
not contain `verify`. That second check exists because `medusa exec` loads
`.env` itself — the guard does not trust what the wrapper exported.

To run against some other database deliberately, set
`SCHEMA_VERIFY_ALLOW_ANY_DB=1`. It writes and deletes rows, so do not point
it at production.
