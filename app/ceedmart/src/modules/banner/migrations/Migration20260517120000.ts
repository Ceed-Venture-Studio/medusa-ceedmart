import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260517120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "banner" (
        "id" text not null,
        "name" text not null,
        "slot" text not null,
        "image_url" text not null,
        "image_key" text null,
        "image_width" integer not null,
        "image_height" integer not null,
        "image_mime_type" text not null,
        "link_url" text null,
        "alt_text" text null,
        "starts_at" timestamptz null,
        "ends_at" timestamptz null,
        "priority" integer not null default 0,
        "status" text not null default 'draft',
        "sales_channel_id" text null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "banner_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_banner_slot" on "banner" ("slot") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_banner_status" on "banner" ("status") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_banner_sales_channel_id" on "banner" ("sales_channel_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_banner_created_at" on "banner" ("created_at") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "banner" cascade;`)
  }
}
