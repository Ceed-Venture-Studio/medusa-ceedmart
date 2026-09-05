import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260904090000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "audit_event" (
        "id" text not null,
        "entity_type" text not null,
        "entity_id" text not null,
        "action" text not null,
        "from_value" text null,
        "to_value" text null,
        "changes" jsonb null,
        "actor_type" text not null default 'system',
        "actor_id" text null,
        "actor_label" text null,
        "reason" text null,
        "correlation_id" text null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "audit_event_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_audit_event_entity" on "audit_event" ("entity_type", "entity_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_audit_event_actor_id" on "audit_event" ("actor_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_audit_event_action" on "audit_event" ("action") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_audit_event_correlation_id" on "audit_event" ("correlation_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_audit_event_created_at" on "audit_event" ("created_at") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "audit_event" cascade;`)
  }
}
