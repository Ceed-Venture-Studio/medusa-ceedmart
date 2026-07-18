import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260718000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "tax_override" (
        "id" text not null,
        "name" text not null,
        "rate" numeric not null,
        "is_tax_inclusive" boolean not null default false,
        "scope" text not null,
        "reference_id" text null,
        "is_active" boolean not null default true,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "tax_override_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create index if not exists "IDX_tax_override_scope" on "tax_override" ("scope") where "deleted_at" is null;`
    )
    this.addSql(
      `create index if not exists "IDX_tax_override_reference_id" on "tax_override" ("reference_id") where "deleted_at" is null;`
    )
    this.addSql(
      `create index if not exists "IDX_tax_override_is_active" on "tax_override" ("is_active") where "deleted_at" is null;`
    )
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "tax_override" cascade;`)
  }
}
