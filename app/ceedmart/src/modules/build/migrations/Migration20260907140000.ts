import { Migration } from "@medusajs/framework/mikro-orm/migrations"

// Stop asking a custom-build customer for a budget.
//
// The range was collected to steer a specialist's recommendation, but it
// only ever worked in one direction: a shopper who has not priced parts
// guesses low, and every quote above the number they typed then reads as
// being overcharged. We do not know what a build costs until the parts are
// sourced, so we should not invite them to anchor on a figure first.
//
// The check constraint goes with the columns — Postgres would drop it
// anyway, but naming it here keeps the intent legible.

export class Migration20260907140000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      alter table if exists "build_request"
        drop constraint if exists "build_request_budget_check";
    `)

    this.addSql(`
      alter table if exists "build_request"
        drop column if exists "budget_min",
        drop column if exists "raw_budget_min",
        drop column if exists "budget_max",
        drop column if exists "raw_budget_max",
        drop column if exists "currency_code";
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      alter table if exists "build_request"
        add column if not exists "budget_min" numeric null,
        add column if not exists "raw_budget_min" jsonb null,
        add column if not exists "budget_max" numeric null,
        add column if not exists "raw_budget_max" jsonb null,
        add column if not exists "currency_code" text not null default 'ngn';
    `)

    this.addSql(`
      alter table if exists "build_request"
        add constraint "build_request_budget_check" check (
          "budget_min" is null or "budget_max" is null or "budget_max" >= "budget_min"
        );
    `)
  }
}
