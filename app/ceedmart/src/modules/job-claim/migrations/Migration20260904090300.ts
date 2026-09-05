import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260904090300 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "job_claim" (
        "id" text not null,
        "scope" text not null,
        "work_id" text not null,
        "claimed_at" timestamptz not null,
        "expires_at" timestamptz not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "job_claim_pkey" primary key ("id")
      );
    `)
    // Not partial on deleted_at: ON CONFLICT needs a total unique index to
    // arbitrate on, and claims are hard-deleted rather than soft-deleted.
    this.addSql(`create unique index if not exists "IDX_job_claim_scope_work" on "job_claim" ("scope", "work_id");`)
    this.addSql(`create index if not exists "IDX_job_claim_expires_at" on "job_claim" ("expires_at");`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "job_claim" cascade;`)
  }
}
