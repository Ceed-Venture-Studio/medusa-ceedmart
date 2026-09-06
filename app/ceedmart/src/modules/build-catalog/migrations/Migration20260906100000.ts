import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260906100000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "build_type" (
        "id" text not null,
        "code" text not null,
        "label" text not null,
        "description" text null,
        "customer_blurb" text null,
        "is_active" boolean not null default true,
        "sort_order" integer not null default 0,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "build_type_pkey" primary key ("id")
      );
    `)
    this.addSql(`create unique index if not exists "IDX_build_type_code" on "build_type" ("code") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_build_type_active" on "build_type" ("is_active") where "deleted_at" is null;`)

    this.addSql(`alter table if exists "build_component_category" add column if not exists "build_types" jsonb null;`)
    this.addSql(`alter table if exists "build_component_category" add column if not exists "attribute_schema" jsonb null;`)

    // Drop the enum that made a third build type a migration rather than an
    // admin action (§7.1 "an architecture that can later support other
    // configurable products").
    this.addSql(`alter table if exists "build_component_category" drop constraint if exists "build_component_category_applies_check";`)

    // Carry the existing rows over to the array form.
    this.addSql(`
      update "build_component_category"
         set "build_types" = case
               when "applies_to" = 'both' then '["desktop","laptop"]'::jsonb
               else to_jsonb(array["applies_to"])
             end
       where "build_types" is null;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`alter table if exists "build_component_category" drop column if exists "attribute_schema";`)
    this.addSql(`alter table if exists "build_component_category" drop column if exists "build_types";`)
    this.addSql(`drop table if exists "build_type" cascade;`)
  }
}
