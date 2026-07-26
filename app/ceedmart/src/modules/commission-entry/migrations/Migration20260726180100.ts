import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260726180100 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "commission_entry" (
        "id" text not null,
        "partner_id" text not null,
        "partner_code" text not null,
        "order_id" text not null,
        "order_display_id" integer null,
        "eligible_amount" numeric not null,
        "eligible_amount_raw" jsonb null,
        "eligible_basis" text not null default 'subtotal_ex_tax',
        "currency_code" text not null,
        "commission_rate" numeric not null,
        "commission_amount" numeric not null,
        "commission_amount_raw" jsonb null,
        "status" text not null default 'pending',
        "reason" text null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "commission_entry_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_commission_entry_partner_id" on "commission_entry" ("partner_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_commission_entry_order_id" on "commission_entry" ("order_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_commission_entry_status" on "commission_entry" ("status") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_commission_entry_created_at" on "commission_entry" ("created_at") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "commission_entry" cascade;`)
  }
}
