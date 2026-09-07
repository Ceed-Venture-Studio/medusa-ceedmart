import { Migration } from "@medusajs/framework/mikro-orm/migrations"

// Take the money out of the catalogue.
//
// A custom build is priced by a specialist after they have checked what the
// parts actually cost to source that week. The indicative figures on each
// option, and the running estimate on a saved configuration, were guesses
// presented in the shape of a price — a customer reads "₦6,500,000" beside
// a part as what it costs, and is then quoted something else.
//
// The columns go rather than being left unused: a nullable price column is
// an invitation for someone to fill it in, and the next person to read the
// model has no way to know it was abandoned on purpose.
//
// currency_code goes with them. It existed only to denominate these
// amounts; the quote carries its own, and that is the only figure in the
// build flow anyone is asked to pay.
//
// The 140100 timestamp, not 140000: Medusa records every module's
// migrations in ONE mikro_orm_migrations table keyed by class name, so the
// build module's same-minute migration claimed that name and this one was
// silently skipped as already-executed. Migration names are global here.

export class Migration20260907140100 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      alter table if exists "build_component_option"
        drop column if exists "indicative_price",
        drop column if exists "raw_indicative_price",
        drop column if exists "currency_code";
    `)

    this.addSql(`
      alter table if exists "build_configuration"
        drop column if exists "estimated_total",
        drop column if exists "raw_estimated_total",
        drop column if exists "currency_code";
    `)
  }

  async down(): Promise<void> {
    // Restores the shape, not the values — the amounts are gone, and the
    // point of the change is that we could not stand behind them anyway.
    this.addSql(`
      alter table if exists "build_component_option"
        add column if not exists "indicative_price" numeric null,
        add column if not exists "raw_indicative_price" jsonb null,
        add column if not exists "currency_code" text not null default 'ngn';
    `)

    this.addSql(`
      alter table if exists "build_configuration"
        add column if not exists "estimated_total" numeric null,
        add column if not exists "raw_estimated_total" jsonb null,
        add column if not exists "currency_code" text not null default 'ngn';
    `)
  }
}
