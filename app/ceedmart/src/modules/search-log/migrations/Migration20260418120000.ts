import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260418120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "search_log" (
        "id" text not null,
        "query" text not null,
        "result_count" integer not null default 0,
        "result_ids" jsonb null,
        "customer_id" text null,
        "session_id" text null,
        "sales_channel_id" text null,
        "region_id" text null,
        "currency_code" text null,
        "filters" jsonb null,
        "locale" text null,
        "user_agent" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "search_log_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create index if not exists "IDX_search_log_customer_id" on "search_log" ("customer_id") where "deleted_at" is null;`
    )
    this.addSql(
      `create index if not exists "IDX_search_log_session_id" on "search_log" ("session_id") where "deleted_at" is null;`
    )
    this.addSql(
      `create index if not exists "IDX_search_log_sales_channel_id" on "search_log" ("sales_channel_id") where "deleted_at" is null;`
    )
    this.addSql(
      `create index if not exists "IDX_search_log_created_at" on "search_log" ("created_at") where "deleted_at" is null;`
    )
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "search_log" cascade;`)
  }
}
