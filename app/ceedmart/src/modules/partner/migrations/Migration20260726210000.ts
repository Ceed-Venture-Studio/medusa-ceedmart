import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260726210000 extends Migration {
  async up(): Promise<void> {
    // Add tier column; existing rows default to PARTNER (they were created
    // under the old model where the default rate was 0.07 = 7% = Partner
    // tier). New rows default to SHOPPER at the model layer.
    this.addSql(`alter table "partner" add column if not exists "tier" text not null default 'PARTNER';`)
    this.addSql(`alter table "partner" alter column "tier" set default 'SHOPPER';`)
    this.addSql(`create index if not exists "IDX_partner_tier" on "partner" ("tier") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_partner_tier";`)
    this.addSql(`alter table "partner" drop column if exists "tier";`)
  }
}
