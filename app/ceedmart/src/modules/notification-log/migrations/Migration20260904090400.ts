import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260904090400 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "notification_log" (
        "id" text not null,
        "channel" text not null,
        "template" text null,
        "trigger_type" text null,
        "recipient" text null,
        "subject" text null,
        "resource_id" text null,
        "resource_type" text null,
        "correlation_id" text null,
        "status" text not null default 'sent',
        "provider_response" jsonb null,
        "error_message" text null,
        "attempt" integer not null default 1,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "notification_log_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_notification_log_status" on "notification_log" ("status") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_notification_log_channel" on "notification_log" ("channel") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_notification_log_resource_id" on "notification_log" ("resource_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_notification_log_trigger_type" on "notification_log" ("trigger_type") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_notification_log_correlation_id" on "notification_log" ("correlation_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_notification_log_created_at" on "notification_log" ("created_at") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "notification_log" cascade;`)
  }
}
