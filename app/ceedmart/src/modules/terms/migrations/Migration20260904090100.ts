import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260904090100 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "terms_document" (
        "id" text not null,
        "slug" text not null,
        "name" text not null,
        "description" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "terms_document_pkey" primary key ("id")
      );
    `)
    this.addSql(`create unique index if not exists "IDX_terms_document_slug" on "terms_document" ("slug") where "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "terms_version" (
        "id" text not null,
        "document_id" text not null,
        "version" integer not null,
        "body" text not null,
        "change_note" text null,
        "published_at" timestamptz null,
        "is_current" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "terms_version_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_terms_version_document_id" on "terms_version" ("document_id") where "deleted_at" is null;`)
    this.addSql(`create unique index if not exists "IDX_terms_version_document_version" on "terms_version" ("document_id", "version") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_terms_version_is_current" on "terms_version" ("is_current") where "deleted_at" is null;`)
    // At most one current version per document — enforced by the database so
    // a race between two publishes cannot leave checkout ambiguous.
    this.addSql(`create unique index if not exists "IDX_terms_version_one_current" on "terms_version" ("document_id") where "is_current" = true and "deleted_at" is null;`)

    this.addSql(`
      create table if not exists "terms_acceptance" (
        "id" text not null,
        "version_id" text not null,
        "document_slug" text not null,
        "customer_id" text null,
        "contact" text null,
        "entity_type" text not null,
        "entity_id" text not null,
        "accepted_at" timestamptz not null,
        "ip_address" text null,
        "user_agent" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "terms_acceptance_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_terms_acceptance_entity" on "terms_acceptance" ("entity_type", "entity_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_terms_acceptance_customer_id" on "terms_acceptance" ("customer_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_terms_acceptance_version_id" on "terms_acceptance" ("version_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "IDX_terms_acceptance_accepted_at" on "terms_acceptance" ("accepted_at") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "terms_acceptance" cascade;`)
    this.addSql(`drop table if exists "terms_version" cascade;`)
    this.addSql(`drop table if exists "terms_document" cascade;`)
  }
}
