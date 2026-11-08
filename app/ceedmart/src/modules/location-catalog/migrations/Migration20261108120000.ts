import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261108120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "location_price" (
        "id" text not null,
        "product_id" text null,
        "variant_id" text null,
        "province" text not null,
        "currency_code" text not null,
        "amount" numeric not null,
        "raw_amount" jsonb not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "location_price_pkey" primary key ("id"),
        constraint "location_price_target_check" check (
          ("product_id" is not null and "variant_id" is null)
          or ("product_id" is null and "variant_id" is not null)
        ),
        constraint "location_price_amount_check" check ("amount" >= 0)
      );
    `)
    this.addSql(`create index if not exists "IDX_location_price_province" on "location_price" ("province") where "deleted_at" is null;`)
    // One price per target, state and currency.
    this.addSql(`create unique index if not exists "IDX_location_price_product" on "location_price" ("product_id", "province", "currency_code") where "product_id" is not null and "deleted_at" is null;`)
    this.addSql(`create unique index if not exists "IDX_location_price_variant" on "location_price" ("variant_id", "province", "currency_code") where "variant_id" is not null and "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "location_availability" (
        "id" text not null,
        "product_id" text null,
        "variant_id" text null,
        "province" text not null,
        "is_available" boolean not null default true,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "location_availability_pkey" primary key ("id"),
        constraint "location_availability_target_check" check (
          ("product_id" is not null and "variant_id" is null)
          or ("product_id" is null and "variant_id" is not null)
        )
      );
    `)
    this.addSql(`create index if not exists "IDX_location_availability_province" on "location_availability" ("province") where "deleted_at" is null;`)
    // One setting per target and state.
    this.addSql(`create unique index if not exists "IDX_location_availability_product" on "location_availability" ("product_id", "province") where "product_id" is not null and "deleted_at" is null;`)
    this.addSql(`create unique index if not exists "IDX_location_availability_variant" on "location_availability" ("variant_id", "province") where "variant_id" is not null and "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "location_availability" cascade;`)
    this.addSql(`drop table if exists "location_price" cascade;`)
  }
}
