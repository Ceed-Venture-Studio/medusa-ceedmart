import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260601000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "requisition" (
        "id" text not null,
        "title" text not null,
        "description" text not null,
        "apply_url" text not null,
        "salary" text null,
        "status" text not null default 'open',
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "requisition_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create index if not exists "IDX_requisition_status" on "requisition" ("status") where "deleted_at" is null;`
    )
    this.addSql(
      `create index if not exists "IDX_requisition_created_at" on "requisition" ("created_at") where "deleted_at" is null;`
    )
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "requisition" cascade;`)
  }
}
