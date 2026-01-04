// src/models/cases.js
import { pool } from "../db.js";

export async function listCases() {
  const { rows } = await pool.query(
    `SELECT id, state, title, created_at, updated_at
     FROM cases
     ORDER BY created_at DESC
     LIMIT 50`
  );
  return rows;
}

export async function getCaseById(id) {
  const { rows } = await pool.query(
    `SELECT
       id, state, title, description, created_by,
       updated_by, assigned_to,
       person_name, nhs_number,
       dob_day, dob_month, dob_year,
       symptoms_day, symptoms_month, symptoms_year,
       postcode, organisation,
       created_at, updated_at
     FROM cases
     WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function getCaseEventById(eventId) {
  const { rows } = await pool.query(
    `SELECT
       id, case_id, event_type, from_state, to_state, actor_id, comment, occurred_at, event_data
     FROM case_events
     WHERE id = $1`,
    [eventId]
  );
  return rows[0] || null;
}

export async function createCase({ title, description, createdBy = "local-user" }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const insertCase = await client.query(
      `INSERT INTO cases (title, description, created_by, updated_by)
       VALUES ($1, $2, $3, $3)
       RETURNING
         id, state, title, description, created_by,
         updated_by, assigned_to,
         person_name, nhs_number,
         dob_day, dob_month, dob_year,
         symptoms_day, symptoms_month, symptoms_year,
         postcode, organisation,
         created_at, updated_at`,
      [title, description || null, createdBy]
    );

    const c = insertCase.rows[0];

    await client.query(
      `INSERT INTO case_events (case_id, event_type, from_state, to_state, actor_id)
       VALUES ($1, 'CREATE', NULL, $2, $3)`,
      [c.id, c.state, createdBy]
    );

    await client.query("COMMIT");
    return c;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

function pickCaseSnapshot(c) {
  if (!c) return null;
  return {
    title: c.title ?? null,
    description: c.description ?? null,
    person_name: c.person_name ?? null,
    nhs_number: c.nhs_number ?? null,
    dob_day: c.dob_day ?? null,
    dob_month: c.dob_month ?? null,
    dob_year: c.dob_year ?? null,
    symptoms_day: c.symptoms_day ?? null,
    symptoms_month: c.symptoms_month ?? null,
    symptoms_year: c.symptoms_year ?? null,
    postcode: c.postcode ?? null,
    organisation: c.organisation ?? null,
    updated_by: c.updated_by ?? null,
    assigned_to: c.assigned_to ?? null,
    state: c.state ?? null
  };
}

async function insertEvent(client, { caseId, eventType, state, actorId, comment = null, eventData = null }) {
  const { rows } = await client.query(
    `INSERT INTO case_events (case_id, event_type, from_state, to_state, actor_id, comment, event_data)
     VALUES ($1, $2, $3, $3, $4, $5, $6)
     RETURNING id`,
    [caseId, eventType, state, actorId, comment, eventData]
  );
  return rows[0].id;
}

export async function updateCaseDetails({ id, title, description, actorId = "local-user" }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const before = await client.query(`SELECT * FROM cases WHERE id = $1`, [id]);
    const beforeRow = before.rows[0];
    if (!beforeRow) {
      await client.query("ROLLBACK");
      return null;
    }

    const { rows } = await client.query(
      `UPDATE cases
       SET title = $2,
           description = $3,
           updated_by = $4,
           updated_at = NOW()
       WHERE id = $1
       RETURNING
         id, state, title, description, created_by,
         updated_by, assigned_to,
         person_name, nhs_number,
         dob_day, dob_month, dob_year,
         symptoms_day, symptoms_month, symptoms_year,
         postcode, organisation,
         created_at, updated_at`,
      [id, title, description || null, actorId]
    );

    const updated = rows[0];

    const eventId = await insertEvent(client, {
      caseId: id,
      eventType: "EDIT_DETAILS",
      state: updated.state,
      actorId,
      eventData: { before: pickCaseSnapshot(beforeRow), after: pickCaseSnapshot(updated) }
    });

    await client.query("COMMIT");
    return { case: updated, eventId };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function updatePersonDetails({
  id,
  personName,
  nhsNumber,
  dobDay,
  dobMonth,
  dobYear,
  actorId = "local-user"
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const before = await client.query(`SELECT * FROM cases WHERE id = $1`, [id]);
    const beforeRow = before.rows[0];
    if (!beforeRow) {
      await client.query("ROLLBACK");
      return null;
    }

    const { rows } = await client.query(
      `UPDATE cases
       SET person_name = $2,
           nhs_number = $3,
           dob_day = $4,
           dob_month = $5,
           dob_year = $6,
           updated_by = $7,
           updated_at = NOW()
       WHERE id = $1
       RETURNING
         id, state, title, description, created_by,
         updated_by, assigned_to,
         person_name, nhs_number,
         dob_day, dob_month, dob_year,
         symptoms_day, symptoms_month, symptoms_year,
         postcode, organisation,
         created_at, updated_at`,
      [id, personName || null, nhsNumber || null, dobDay || null, dobMonth || null, dobYear || null, actorId]
    );

    const updated = rows[0];

    const eventId = await insertEvent(client, {
      caseId: id,
      eventType: "EDIT_PERSON",
      state: updated.state,
      actorId,
      eventData: { before: pickCaseSnapshot(beforeRow), after: pickCaseSnapshot(updated) }
    });

    await client.query("COMMIT");
    return { case: updated, eventId };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function updateClinicalDetails({ id, symptomsDay, symptomsMonth, symptomsYear, actorId = "local-user" }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const before = await client.query(`SELECT * FROM cases WHERE id = $1`, [id]);
    const beforeRow = before.rows[0];
    if (!beforeRow) {
      await client.query("ROLLBACK");
      return null;
    }

    const { rows } = await client.query(
      `UPDATE cases
       SET symptoms_day = $2,
           symptoms_month = $3,
           symptoms_year = $4,
           updated_by = $5,
           updated_at = NOW()
       WHERE id = $1
       RETURNING
         id, state, title, description, created_by,
         updated_by, assigned_to,
         person_name, nhs_number,
         dob_day, dob_month, dob_year,
         symptoms_day, symptoms_month, symptoms_year,
         postcode, organisation,
         created_at, updated_at`,
      [id, symptomsDay || null, symptomsMonth || null, symptomsYear || null, actorId]
    );

    const updated = rows[0];

    const eventId = await insertEvent(client, {
      caseId: id,
      eventType: "EDIT_CLINICAL",
      state: updated.state,
      actorId,
      eventData: { before: pickCaseSnapshot(beforeRow), after: pickCaseSnapshot(updated) }
    });

    await client.query("COMMIT");
    return { case: updated, eventId };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function updateLocationDetails({ id, postcode, organisation, actorId = "local-user" }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const before = await client.query(`SELECT * FROM cases WHERE id = $1`, [id]);
    const beforeRow = before.rows[0];
    if (!beforeRow) {
      await client.query("ROLLBACK");
      return null;
    }

    const { rows } = await client.query(
      `UPDATE cases
       SET postcode = $2,
           organisation = $3,
           updated_by = $4,
           updated_at = NOW()
       WHERE id = $1
       RETURNING
         id, state, title, description, created_by,
         updated_by, assigned_to,
         person_name, nhs_number,
         dob_day, dob_month, dob_year,
         symptoms_day, symptoms_month, symptoms_year,
         postcode, organisation,
         created_at, updated_at`,
      [id, postcode || null, organisation || null, actorId]
    );

    const updated = rows[0];

    const eventId = await insertEvent(client, {
      caseId: id,
      eventType: "EDIT_LOCATION",
      state: updated.state,
      actorId,
      eventData: { before: pickCaseSnapshot(beforeRow), after: pickCaseSnapshot(updated) }
    });

    await client.query("COMMIT");
    return { case: updated, eventId };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function transitionCase({ id, eventType, comment = null, actorId = "local-user" }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const current = await client.query(`SELECT id, state FROM cases WHERE id = $1`, [id]);
    const c = current.rows[0];
    if (!c) {
      await client.query("ROLLBACK");
      return null;
    }

    const fromState = c.state;

    let toState = fromState;
    if (eventType === "SUBMIT_FOR_REVIEW") toState = "IN_REVIEW";
    if (eventType === "RETURN") toState = "RETURNED";
    if (eventType === "APPROVE") toState = "APPROVED";

    const updatedCase = await client.query(
      `UPDATE cases
       SET state = $2,
           updated_by = $3,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, state, title, created_at, updated_at`,
      [id, toState, actorId]
    );

    await client.query(
      `INSERT INTO case_events (case_id, event_type, from_state, to_state, comment, actor_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, eventType, fromState, toState, comment, actorId]
    );

    await client.query("COMMIT");
    return updatedCase.rows[0];
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function listCaseEvents(caseId) {
  const { rows } = await pool.query(
    `SELECT id, case_id, event_type, from_state, to_state, comment, actor_id, occurred_at
     FROM case_events
     WHERE case_id = $1
     ORDER BY occurred_at DESC`,
    [caseId]
  );
  return rows;
}
