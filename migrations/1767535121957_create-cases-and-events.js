export const shorthands = undefined;

export async function up(pgm) {
  pgm.createExtension("pgcrypto", { ifNotExists: true });

  pgm.createTable("cases", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    state: { type: "text", notNull: true, default: "DRAFT" },
    title: { type: "text", notNull: true },
    description: { type: "text", notNull: false },
    created_by: { type: "text", notNull: true, default: "local-user" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    version: { type: "integer", notNull: true, default: 1 }
  });

  pgm.createTable("case_events", {
    id: { type: "bigserial", primaryKey: true },
    case_id: { type: "uuid", notNull: true, references: "cases(id)", onDelete: "cascade" },
    event_type: { type: "text", notNull: true },
    from_state: { type: "text", notNull: false },
    to_state: { type: "text", notNull: false },
    actor_id: { type: "text", notNull: true, default: "local-user" },
    comment: { type: "text", notNull: false },
    occurred_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  pgm.createIndex("case_events", ["case_id", "occurred_at"]);
}

export async function down(pgm) {
  pgm.dropTable("case_events");
  pgm.dropTable("cases");
}
