import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260726180000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "partner" (
        "id" text not null,
        "name" text not null,
        "email" text null,
        "phone" text null,
        "company" text null,
        "code" text not null,
        "commission_rate" numeric not null default 0.07,
        "status" text not null default 'active',
        "notes" text null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "partner_pkey" primary key ("id")
      );
    `)
    this.addSql(`create unique index if not exists "IDX_partner_code_unique" on "partner" ("code") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_partner_status" on "partner" ("status") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_partner_created_at" on "partner" ("created_at") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "partner" cascade;`)
  }
}
