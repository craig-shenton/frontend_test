export const shorthands = undefined;

export async function up(pgm) {
  pgm.addColumns(
    "cases",
    {
      person_name: { type: "text" },
      nhs_number: { type: "text" },
      dob_day: { type: "integer" },
      dob_month: { type: "integer" },
      dob_year: { type: "integer" },
      symptoms_day: { type: "integer" },
      symptoms_month: { type: "integer" },
      symptoms_year: { type: "integer" },
      postcode: { type: "text" },
      organisation: { type: "text" }
    },
    { ifNotExists: true }
  );
}

export async function down(pgm) {
  pgm.dropColumns(
    "cases",
    [
      "organisation",
      "postcode",
      "symptoms_year",
      "symptoms_month",
      "symptoms_day",
      "dob_year",
      "dob_month",
      "dob_day",
      "nhs_number",
      "person_name"
    ],
    { ifExists: true }
  );
}
