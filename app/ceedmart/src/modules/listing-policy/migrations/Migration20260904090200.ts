import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260904090200 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "listing_policy" (
        "id" text not null,
        "product_id" text null,
        "variant_id" text null,
        "commerce_type" text not null default 'standard',
        "is_active" boolean not null default true,
        "config" jsonb null,
        "reference_id" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "listing_policy_pkey" primary key ("id"),
        constraint "listing_policy_target_check" check (
          ("product_id" is not null and "variant_id" is null)
          or ("product_id" is null and "variant_id" is not null)
        ),
        constraint "listing_policy_commerce_type_check" check (
          "commerce_type" in ('standard', 'preorder', 'custom_build', 'auction')
        )
      );
    `)
    this.addSql(`create index if not exists "IDX_listing_policy_commerce_type" on "listing_policy" ("commerce_type") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_listing_policy_is_active" on "listing_policy" ("is_active") where "deleted_at" is null;`)
    // One policy per target — a listing has exactly one commerce type.
    this.addSql(`create unique index if not exists "IDX_listing_policy_product" on "listing_policy" ("product_id") where "product_id" is not null and "deleted_at" is null;`)
    this.addSql(`create unique index if not exists "IDX_listing_policy_variant" on "listing_policy" ("variant_id") where "variant_id" is not null and "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "listing_policy" cascade;`)
  }
}
