export const shorthands = undefined;

export async function up(pgm) {
  pgm.addColumn("case_events", {
    event_data: { type: "jsonb" }
  });
}

export async function down(pgm) {
  pgm.dropColumn("case_events", "event_data");
}
