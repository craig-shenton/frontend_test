export const shorthands = undefined;

export async function up(pgm) {
  pgm.addColumns("cases", {
    updated_by: { type: "text", notNull: true, default: "local-user" },
    assigned_to: { type: "text", notNull: false }
  });
}

export async function down(pgm) {
  pgm.dropColumns("cases", ["updated_by", "assigned_to"]);
}
