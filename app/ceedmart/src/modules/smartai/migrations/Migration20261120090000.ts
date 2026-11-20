import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261120090000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "smartai_shopper_cart" (
        "id" text not null,
        "shopper_id" text not null,
        "cart_id" text not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "smartai_shopper_cart_pkey" primary key ("id")
      );
    `)
    // One live cart per shopper: a racing second insert fails here and the
    // caller re-reads the winner's row.
    this.addSql(`create unique index if not exists "IDX_smartai_shopper_cart_shopper_id_unique" on "smartai_shopper_cart" ("shopper_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_smartai_shopper_cart_cart_id" on "smartai_shopper_cart" ("cart_id") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "smartai_shopper_cart" cascade;`)
  }
}
