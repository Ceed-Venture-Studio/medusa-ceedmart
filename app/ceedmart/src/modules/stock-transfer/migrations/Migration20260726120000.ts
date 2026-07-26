import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260726120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "stock_transfer" (
        "id" text not null,
        "from_location_id" text not null,
        "to_location_id" text not null,
        "from_location_name" text null,
        "to_location_name" text null,
        "inventory_item_id" text not null,
        "variant_id" text null,
        "variant_sku" text null,
        "product_title" text null,
        "quantity" integer not null,
        "order_id" text null,
        "order_display_id" integer null,
        "reason" text not null default 'auto_pull_on_order',
        "status" text not null default 'completed',
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "stock_transfer_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_stock_transfer_order_id" on "stock_transfer" ("order_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_stock_transfer_from_location_id" on "stock_transfer" ("from_location_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_stock_transfer_to_location_id" on "stock_transfer" ("to_location_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_stock_transfer_created_at" on "stock_transfer" ("created_at") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "stock_transfer" cascade;`)
  }
}
