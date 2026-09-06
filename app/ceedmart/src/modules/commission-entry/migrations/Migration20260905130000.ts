import { Migration } from "@medusajs/framework/mikro-orm/migrations"

// Fix the raw-column naming on commission_entry.
//
// Medusa's `model.bigNumber()` stores the precise value in a companion JSONB
// column named `raw_<field>` — see raw_amount on `price`, raw_quantity on
// `reservation_item`. The original migration created `<field>_raw` instead,
// so the column the ORM looks for does not exist.
//
// The effect: every insert into commission_entry fails with
// `column "raw_eligible_amount" of relation "commission_entry" does not
// exist`. Partner commission has therefore been accruing NOTHING since M3
// shipped — the subscriber catches and logs the error, so it failed quietly.
//
// This is the second half of the same story as the P0-1 metadata fix: that
// one dropped the partner code before accrual could read it, this one would
// have rejected the write even when the code survived.
//
// Renaming rather than adding: the mis-named columns have never held data,
// precisely because no insert ever succeeded.

export class Migration20260905130000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      alter table if exists "commission_entry"
        rename column "eligible_amount_raw" to "raw_eligible_amount";
    `)
    this.addSql(`
      alter table if exists "commission_entry"
        rename column "commission_amount_raw" to "raw_commission_amount";
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      alter table if exists "commission_entry"
        rename column "raw_eligible_amount" to "eligible_amount_raw";
    `)
    this.addSql(`
      alter table if exists "commission_entry"
        rename column "raw_commission_amount" to "commission_amount_raw";
    `)
  }
}
