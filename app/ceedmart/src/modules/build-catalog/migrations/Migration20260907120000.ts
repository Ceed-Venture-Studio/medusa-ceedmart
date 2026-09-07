import { Migration } from "@medusajs/framework/mikro-orm/migrations"
import {
  BUILD_TYPES,
  CATEGORIES,
  OPTIONS,
} from "../../../lib/build-catalog/catalog-data"
import { CATEGORY_SCHEMAS } from "../../../lib/build-catalog/schema"

// Seed the build catalogue as part of migrating.
//
// ── Why a migration and not the seed script ─────────────────────────────
// `db:migrate` is the one thing that reliably runs on a deploy. A catalogue
// that only exists after someone remembers to run `medusa exec` is a
// catalogue production does not have — the configurator would ship with
// every slot empty and no error to explain it.
//
// It reads the SAME definition the seed script does, so local and
// production cannot disagree about what a slot is or which parts fill it.
// Two copies of this data would drift within a week.
//
// ── Idempotent, and non-destructive ─────────────────────────────────────
// Everything is INSERT ... ON CONFLICT DO UPDATE against the natural key —
// a category's code, an option's (category, label). Re-running corrects
// drift rather than duplicating rows, which matters because this runs on
// every deploy.
//
// It never deletes. Options ops has added by hand survive, and slots that
// have been retired are deactivated rather than dropped, because existing
// build requests reference them and their history should stay readable.

const q = (value: string): string => `'${value.replace(/'/g, "''")}'`

const json = (value: unknown): string =>
  value === null || value === undefined
    ? "null"
    : `${q(JSON.stringify(value))}::jsonb`

const nullableNumber = (value: number | null | undefined): string =>
  value === null || value === undefined ? "null" : String(value)

/**
 * The companion column for a model.bigNumber() field.
 *
 * `value` is stored as a STRING — Medusa writes {"value": "32000000",
 * "precision": 20} — because the whole point of the raw column is to survive
 * numbers JavaScript cannot hold exactly. Writing a JSON number here would
 * round-trip differently from every row the ORM has written.
 */
const rawBigNumber = (value: number | null | undefined): string =>
  value === null || value === undefined
    ? "null"
    : `jsonb_build_object('value', ${q(String(value))}, 'precision', 20)`

export class Migration20260907120000 extends Migration {
  async up(): Promise<void> {
    // Build types
    for (const type of BUILD_TYPES) {
      this.addSql(`
        insert into "build_type"
          ("id", "code", "label", "description", "customer_blurb", "is_active", "sort_order", "created_at", "updated_at")
        values (
          ${q(`btype_seed_${type.code}`)}, ${q(type.code)}, ${q(type.label)},
          ${q(type.description)}, ${q(type.customer_blurb)}, true, ${type.sort_order},
          now(), now()
        )
        on conflict ("code") where "deleted_at" is null do update set
          "label" = excluded."label",
          "description" = excluded."description",
          "customer_blurb" = excluded."customer_blurb",
          "sort_order" = excluded."sort_order",
          "updated_at" = now();
      `)
    }

    // Slots. attribute_schema comes from CATEGORY_SCHEMAS, which is what the
    // admin form renders and the CSV importer validates against.
    for (const category of CATEGORIES) {
      const schema = CATEGORY_SCHEMAS.find((c) => c.code === category.code)
      // A retired slot matches no build type, which is what withdraws it.
      const buildTypes =
        category.applies_to === "both"
          ? ["desktop", "laptop"]
          : category.applies_to === "retired"
            ? []
            : [category.applies_to]

      this.addSql(`
        insert into "build_component_category"
          ("id", "code", "label", "applies_to", "build_types", "attribute_schema",
           "is_required", "allows_multiple", "max_quantity", "sort_order", "help_text",
           "created_at", "updated_at")
        values (
          ${q(`bcat_seed_${category.code}`)}, ${q(category.code)}, ${q(category.label)},
          ${q(category.applies_to)}, ${json(buildTypes)}, ${json(schema?.fields ?? null)},
          ${category.is_required}, ${category.allows_multiple ?? false},
          ${category.max_quantity ?? 1}, ${category.sort_order},
          ${category.help_text ? q(category.help_text) : "null"},
          now(), now()
        )
        on conflict ("code") where "deleted_at" is null do update set
          "label" = excluded."label",
          "applies_to" = excluded."applies_to",
          "build_types" = excluded."build_types",
          "attribute_schema" = excluded."attribute_schema",
          "is_required" = excluded."is_required",
          "allows_multiple" = excluded."allows_multiple",
          "max_quantity" = excluded."max_quantity",
          "sort_order" = excluded."sort_order",
          "help_text" = excluded."help_text",
          "updated_at" = now();
      `)
    }

    // Parts. Keyed on (category, label): ids differ between environments and
    // always will, but "the 16GB memory option" means the same thing in both.
    for (const option of OPTIONS) {
      this.addSql(`
        insert into "build_component_option"
          ("id", "category_id", "label", "brand", "indicative_price", "raw_indicative_price",
           "currency_code", "attributes", "is_fixed", "is_active", "sort_order",
           "created_at", "updated_at")
        select
          ${q(`bopt_seed_${option.category}_${option.label}`.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 60))},
          c."id", ${q(option.label)}, ${option.brand ? q(option.brand) : "null"},
          ${nullableNumber(option.indicative_price)},
          ${rawBigNumber(option.indicative_price)},
          'ngn', ${json(option.attributes ?? null)}, false, true,
          ${option.sort_order ?? 0}, now(), now()
        from "build_component_category" c
        where c."code" = ${q(option.category)} and c."deleted_at" is null
          -- Guard on (category, label), not on the primary key. There is no
          -- unique index across those two columns, so ON CONFLICT can only
          -- see the id — and a generated seed id never collides with a ULID
          -- the ORM wrote. Without this every part that already existed got
          -- a second copy.
          and not exists (
            select 1 from "build_component_option" existing
            where existing."category_id" = c."id"
              and existing."label" = ${q(option.label)}
              and existing."deleted_at" is null
          );
      `)

      // Update separately rather than in ON CONFLICT: the unique index is on
      // the id, not on (category_id, label), so a row inserted under a
      // different id in an earlier environment would otherwise be missed.
      this.addSql(`
        update "build_component_option" o
        set "brand" = ${option.brand ? q(option.brand) : "null"},
            "indicative_price" = ${nullableNumber(option.indicative_price)},
            "raw_indicative_price" = ${rawBigNumber(option.indicative_price)},
            "attributes" = ${json(option.attributes ?? null)},
            "sort_order" = ${option.sort_order ?? 0},
            "updated_at" = now()
        from "build_component_category" c
        where c."id" = o."category_id"
          and c."code" = ${q(option.category)}
          and o."label" = ${q(option.label)}
          and o."deleted_at" is null;
      `)
    }
  }

  async down(): Promise<void> {
    // Deliberately empty. Rolling this back would delete a catalogue that
    // ops has since edited, and the rows are harmless if the code that reads
    // them is rolled back — an unused slot is not a broken one.
  }
}
