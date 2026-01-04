// src/server.js
import express from "express";
import nunjucks from "nunjucks";
import path from "path";
import { fileURLToPath } from "url";
import session from "express-session";
import cookieParser from "cookie-parser";
import csrf from "csurf";
import pinoHttp from "pino-http";
import dotenv from "dotenv";

import {
  listCases,
  createCase,
  getCaseById,
  getCaseEventById,
  updateCaseDetails,
  updatePersonDetails,
  updateClinicalDetails,
  updateLocationDetails,
  transitionCase,
  listCaseEvents
} from "./models/cases.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Logging
app.use(pinoHttp());

// Body parsing
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Cookies + session (MVP-only config; do not use this unchanged in production)
app.use(cookieParser());
app.use(
  session({
    name: "case_mvp_sid",
    secret: process.env.SESSION_SECRET || "dev-only-secret-change-me",
    resave: false,
    saveUninitialized: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false
    }
  })
);

// Static assets
app.use("/public", express.static(path.join(__dirname, "public")));

// GOV.UK Frontend assets (served from node_modules)
app.use(
  "/public/govuk",
  express.static(path.join(__dirname, "..", "node_modules", "govuk-frontend", "dist", "govuk"))
);
app.use(
  "/public/govuk-assets",
  express.static(path.join(__dirname, "..", "node_modules", "govuk-frontend", "dist", "govuk", "assets"))
);

// Nunjucks (include GOV.UK Frontend component macros)
const nunjucksEnv = nunjucks.configure(
  [path.join(__dirname, "views"), path.join(__dirname, "..", "node_modules", "govuk-frontend", "dist")],
  { autoescape: true, express: app }
);

// Date/time formatting filter
nunjucksEnv.addFilter("formatDateTime", (value) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${date}, ${time}`;
});

// Helper for D/M/Y triples
function formatDMY(day, month, year) {
  if (!day || !month || !year) return "";
  const d = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

// Explicit filters used by templates
nunjucksEnv.addFilter("formatPersonDob", (c) => formatDMY(c?.dob_day, c?.dob_month, c?.dob_year));
nunjucksEnv.addFilter("formatSymptomsDate", (c) =>
  formatDMY(c?.symptoms_day, c?.symptoms_month, c?.symptoms_year)
);

// Make common variables available to templates
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  next();
});

// CSRF (enable after session)
const csrfProtection = csrf({ cookie: false });
app.use(csrfProtection);

// Make csrf token available to all templates
app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  next();
});

// Footer placeholders
app.get("/accessibility", (req, res) => res.status(200).send("Accessibility statement (placeholder)."));
app.get("/cookies", (req, res) => res.status(200).send("Cookies (placeholder)."));
app.get("/privacy", (req, res) => res.status(200).send("Privacy (placeholder)."));
app.get("/contact", (req, res) => res.status(200).send("Contact (placeholder)."));

// Task status helpers
function hasDob(c) {
  return Boolean(c?.dob_day && c?.dob_month && c?.dob_year);
}
function hasSymptomsDate(c) {
  return Boolean(c?.symptoms_day && c?.symptoms_month && c?.symptoms_year);
}

// GOV.UK task list expects status either as { text: "Completed" } or { tag: { text: "Not started" } }.
function taskStatus({ complete, started }) {
  if (complete) return { text: "Completed" };
  if (started) return { tag: { text: "In progress" } };
  return { tag: { text: "Not started" } };
}

// Build a GOV.UK summary-list rows array from before/after JSON snapshots
function buildChangedRows(before = {}, after = {}) {
  const labelMap = {
    person_name: "Full name",
    nhs_number: "NHS number",
    dob_day: "Date of birth",
    symptoms_day: "Symptoms start date",
    postcode: "Postcode",
    organisation: "Organisation",
    title: "Title",
    description: "Description"
  };

  function displayValue(key, snapshot) {
    if (key === "dob_day") {
      return formatDMY(snapshot.dob_day, snapshot.dob_month, snapshot.dob_year) || "Not provided";
    }
    if (key === "symptoms_day") {
      return formatDMY(snapshot.symptoms_day, snapshot.symptoms_month, snapshot.symptoms_year) || "Not provided";
    }
    const v = snapshot[key];
    if (v === null || v === undefined || v === "") return "Not provided";
    return String(v);
  }

  // Special handling: compare DOB as a group, symptoms date as a group
  const rows = [];

  const simpleKeys = ["person_name", "nhs_number", "postcode", "organisation", "title", "description"];
  for (const k of simpleKeys) {
    const b = before[k] ?? null;
    const a = after[k] ?? null;
    if (String(b ?? "") !== String(a ?? "")) {
      rows.push({
        key: { text: labelMap[k] || k },
        value: {
          html: `<span class="govuk-body">From: ${displayValue(k, before)}</span><br><span class="govuk-body">To: ${displayValue(k, after)}</span>`
        }
      });
    }
  }

  const dobChanged =
    (before.dob_day ?? null) !== (after.dob_day ?? null) ||
    (before.dob_month ?? null) !== (after.dob_month ?? null) ||
    (before.dob_year ?? null) !== (after.dob_year ?? null);
  if (dobChanged) {
    rows.push({
      key: { text: "Date of birth" },
      value: {
        html: `<span class="govuk-body">From: ${displayValue("dob_day", before)}</span><br><span class="govuk-body">To: ${displayValue("dob_day", after)}</span>`
      }
    });
  }

  const symptomsChanged =
    (before.symptoms_day ?? null) !== (after.symptoms_day ?? null) ||
    (before.symptoms_month ?? null) !== (after.symptoms_month ?? null) ||
    (before.symptoms_year ?? null) !== (after.symptoms_year ?? null);
  if (symptomsChanged) {
    rows.push({
      key: { text: "Symptoms start date" },
      value: {
        html: `<span class="govuk-body">From: ${displayValue("symptoms_day", before)}</span><br><span class="govuk-body">To: ${displayValue("symptoms_day", after)}</span>`
      }
    });
  }

  return rows;
}

// Routes
app.get("/", async (req, res, next) => {
  try {
    const cases = await listCases();
    return res.render("index.njk", { title: "Cases", cases });
  } catch (e) {
    return next(e);
  }
});

app.get("/cases/new", (req, res) => {
  res.render("cases-new.njk", { title: "Create case" });
});

app.post("/cases/new", async (req, res, next) => {
  try {
    const title = (req.body.title || "").trim();
    const description = (req.body.description || "").trim();

    if (!title) {
      return res.status(400).render("cases-new.njk", {
        title: "Create case",
        error: "Enter a title",
        form: { title, description }
      });
    }

    const c = await createCase({ title, description, createdBy: "local-user" });
    return res.redirect(`/cases/${c.id}`);
  } catch (e) {
    return next(e);
  }
});

app.get("/cases/:id", async (req, res, next) => {
  try {
    const c = await getCaseById(req.params.id);
    if (!c) return res.status(404).send("Not found");
    return res.render("case-show.njk", { title: "Case", c });
  } catch (e) {
    return next(e);
  }
});

// Task list
app.get("/cases/:id/tasks", async (req, res, next) => {
  try {
    const c = await getCaseById(req.params.id);
    if (!c) return res.status(404).send("Not found");

    const personStarted = Boolean(c.person_name || c.nhs_number || hasDob(c));
    const personComplete = Boolean(c.person_name && c.nhs_number && hasDob(c));

    const clinicalStarted = hasSymptomsDate(c);
    const clinicalComplete = hasSymptomsDate(c);

    const locationStarted = Boolean(c.postcode || c.organisation);
    const locationComplete = Boolean(c.postcode);

    const allComplete = personComplete && clinicalComplete && locationComplete;

    const items = [
      {
        title: { text: "Add person details" },
        href: `/cases/${c.id}/person`,
        status: taskStatus({ complete: personComplete, started: personStarted }),
        hint: { text: "Name, NHS number and date of birth" }
      },
      {
        title: { text: "Add clinical details" },
        href: `/cases/${c.id}/clinical`,
        status: taskStatus({ complete: clinicalComplete, started: clinicalStarted }),
        hint: { text: "Symptoms start date" }
      },
      {
        title: { text: "Add location details" },
        href: `/cases/${c.id}/location`,
        status: taskStatus({ complete: locationComplete, started: locationStarted }),
        hint: { text: "Postcode and organisation" }
      },
      {
        title: { text: "Check answers before submitting" },
        href: `/cases/${c.id}/check-answers`,
        status: taskStatus({ complete: false, started: allComplete }),
        hint: { text: "Review the information before you submit" }
      }
    ];

    return res.render("case-task-list.njk", { title: "Continue case", c, items, allComplete });
  } catch (e) {
    return next(e);
  }
});

// Changes saved (what changed)
app.get("/cases/:id/changes-saved/:eventId", async (req, res, next) => {
  try {
    const c = await getCaseById(req.params.id);
    if (!c) return res.status(404).send("Not found");

    const ev = await getCaseEventById(req.params.eventId);
    if (!ev || String(ev.case_id) !== String(c.id)) return res.status(404).send("Not found");

    const before = ev.event_data?.before || {};
    const after = ev.event_data?.after || {};
    const changedRows = buildChangedRows(before, after);

    return res.render("case-changes-saved.njk", {
      title: "Changes saved",
      c,
      changedRows
    });
  } catch (e) {
    return next(e);
  }
});

// Person task
app.get("/cases/:id/person", async (req, res, next) => {
  try {
    const c = await getCaseById(req.params.id);
    if (!c) return res.status(404).send("Not found");
    return res.render("case-edit-person.njk", { title: "Add person details", c });
  } catch (e) {
    return next(e);
  }
});

app.post("/cases/:id/person", async (req, res, next) => {
  try {
    const personName = (req.body.person_name || "").trim();
    const nhsNumber = (req.body.nhs_number || "").trim();

    const dobDay = Number(req.body.dob_day || 0) || null;
    const dobMonth = Number(req.body.dob_month || 0) || null;
    const dobYear = Number(req.body.dob_year || 0) || null;

    const errors = [];
    if (!personName) errors.push({ text: "Enter a name", href: "#person_name" });
    if (!nhsNumber) errors.push({ text: "Enter an NHS number", href: "#nhs_number" });
    if (!dobDay || !dobMonth || !dobYear) errors.push({ text: "Enter a date of birth", href: "#dob" });

    const c = await getCaseById(req.params.id);
    if (!c) return res.status(404).send("Not found");

    if (errors.length) {
      return res.status(400).render("case-edit-person.njk", {
        title: "Add person details",
        c: {
          ...c,
          person_name: personName,
          nhs_number: nhsNumber,
          dob_day: dobDay,
          dob_month: dobMonth,
          dob_year: dobYear
        },
        errors
      });
    }

    const result = await updatePersonDetails({
      id: req.params.id,
      personName,
      nhsNumber,
      dobDay,
      dobMonth,
      dobYear,
      actorId: "local-user"
    });

    if (!result) return res.status(404).send("Not found");
    return res.redirect(`/cases/${req.params.id}/changes-saved/${result.eventId}`);
  } catch (e) {
    return next(e);
  }
});

// Clinical task
app.get("/cases/:id/clinical", async (req, res, next) => {
  try {
    const c = await getCaseById(req.params.id);
    if (!c) return res.status(404).send("Not found");
    return res.render("case-edit-clinical.njk", { title: "Add clinical details", c });
  } catch (e) {
    return next(e);
  }
});

app.post("/cases/:id/clinical", async (req, res, next) => {
  try {
    const symptomsDay = Number(req.body.symptoms_day || 0) || null;
    const symptomsMonth = Number(req.body.symptoms_month || 0) || null;
    const symptomsYear = Number(req.body.symptoms_year || 0) || null;

    const errors = [];
    if (!symptomsDay || !symptomsMonth || !symptomsYear) {
      errors.push({ text: "Enter a symptoms start date", href: "#symptoms_date" });
    }

    const c = await getCaseById(req.params.id);
    if (!c) return res.status(404).send("Not found");

    if (errors.length) {
      return res.status(400).render("case-edit-clinical.njk", {
        title: "Add clinical details",
        c: { ...c, symptoms_day: symptomsDay, symptoms_month: symptomsMonth, symptoms_year: symptomsYear },
        errors
      });
    }

    const result = await updateClinicalDetails({
      id: req.params.id,
      symptomsDay,
      symptomsMonth,
      symptomsYear,
      actorId: "local-user"
    });

    if (!result) return res.status(404).send("Not found");
    return res.redirect(`/cases/${req.params.id}/changes-saved/${result.eventId}`);
  } catch (e) {
    return next(e);
  }
});

// Location task
app.get("/cases/:id/location", async (req, res, next) => {
  try {
    const c = await getCaseById(req.params.id);
    if (!c) return res.status(404).send("Not found");
    return res.render("case-edit-location.njk", { title: "Add location details", c });
  } catch (e) {
    return next(e);
  }
});

app.post("/cases/:id/location", async (req, res, next) => {
  try {
    const postcode = (req.body.postcode || "").trim();
    const organisation = (req.body.organisation || "").trim();

    const errors = [];
    if (!postcode) errors.push({ text: "Enter a postcode", href: "#postcode" });

    const c = await getCaseById(req.params.id);
    if (!c) return res.status(404).send("Not found");

    if (errors.length) {
      return res.status(400).render("case-edit-location.njk", {
        title: "Add location details",
        c: { ...c, postcode, organisation },
        errors
      });
    }

    const result = await updateLocationDetails({
      id: req.params.id,
      postcode,
      organisation,
      actorId: "local-user"
    });

    if (!result) return res.status(404).send("Not found");
    return res.redirect(`/cases/${req.params.id}/changes-saved/${result.eventId}`);
  } catch (e) {
    return next(e);
  }
});

// Check answers
app.get("/cases/:id/check-answers", async (req, res, next) => {
  try {
    const c = await getCaseById(req.params.id);
    if (!c) return res.status(404).send("Not found");
    return res.render("case-check-answers.njk", { title: "Check answers", c });
  } catch (e) {
    return next(e);
  }
});

// Review (for reviewers)
app.get("/cases/:id/review", async (req, res, next) => {
  try {
    const c = await getCaseById(req.params.id);
    if (!c) return res.status(404).send("Not found");
    return res.render("case-review.njk", { title: "Review case", c });
  } catch (e) {
    return next(e);
  }
});

app.post("/cases/:id/review", async (req, res, next) => {
  try {
    const c = await getCaseById(req.params.id);
    if (!c) return res.status(404).send("Not found");
    return res.render("case-review.njk", { title: "Review case", c });
  } catch (e) {
    return next(e);
  }
});

// Submit confirmation page
app.get("/cases/:id/submit", async (req, res, next) => {
  try {
    const c = await getCaseById(req.params.id);
    if (!c) return res.status(404).send("Not found");
    return res.render("case-submit-confirm.njk", { title: "Submit case for review", c });
  } catch (e) {
    return next(e);
  }
});

// Submit action
app.post("/cases/:id/submit", async (req, res, next) => {
  try {
    const updated = await transitionCase({
      id: req.params.id,
      eventType: "SUBMIT_FOR_REVIEW",
      actorId: "local-user"
    });
    if (!updated) return res.status(404).send("Not found");
    return res.redirect(`/cases/${req.params.id}/submitted`);
  } catch (e) {
    return next(e);
  }
});

// Submitted confirmation page
app.get("/cases/:id/submitted", async (req, res, next) => {
  try {
    const c = await getCaseById(req.params.id);
    if (!c) return res.status(404).send("Not found");
    return res.render("case-submitted.njk", { title: "Case submitted", c });
  } catch (e) {
    return next(e);
  }
});

// Approve confirmation page
app.get("/cases/:id/approve", async (req, res, next) => {
  try {
    const c = await getCaseById(req.params.id);
    if (!c) return res.status(404).send("Not found");
    return res.render("case-approve-confirm.njk", { title: "Approve case", c });
  } catch (e) {
    return next(e);
  }
});

// Approve action
app.post("/cases/:id/approve", async (req, res, next) => {
  try {
    const updated = await transitionCase({
      id: req.params.id,
      eventType: "REVIEW_APPROVE",
      actorId: "local-user"
    });
    if (!updated) return res.status(404).send("Not found");
    return res.redirect(`/cases/${req.params.id}/approved`);
  } catch (e) {
    return next(e);
  }
});

// Approved confirmation page
app.get("/cases/:id/approved", async (req, res, next) => {
  try {
    const c = await getCaseById(req.params.id);
    if (!c) return res.status(404).send("Not found");
    return res.render("case-approved.njk", { title: "Case approved", c });
  } catch (e) {
    return next(e);
  }
});

// Return form
app.get("/cases/:id/return", async (req, res, next) => {
  try {
    const c = await getCaseById(req.params.id);
    if (!c) return res.status(404).send("Not found");
    return res.render("case-return.njk", { title: "Return case", c });
  } catch (e) {
    return next(e);
  }
});

// Return action
app.post("/cases/:id/return", async (req, res, next) => {
  try {
    const comment = (req.body.comment || "").trim();
    const c = await getCaseById(req.params.id);
    if (!c) return res.status(404).send("Not found");

    if (!comment) {
      return res.status(400).render("case-return.njk", {
        title: "Return case",
        c,
        error: "Enter a reason for return",
        form: { comment }
      });
    }

    const updated = await transitionCase({
      id: req.params.id,
      eventType: "REVIEW_RETURN",
      comment,
      actorId: "local-user"
    });
    if (!updated) return res.status(404).send("Not found");
    return res.redirect(`/cases/${req.params.id}/returned`);
  } catch (e) {
    return next(e);
  }
});

// Returned confirmation page
app.get("/cases/:id/returned", async (req, res, next) => {
  try {
    const c = await getCaseById(req.params.id);
    if (!c) return res.status(404).send("Not found");
    return res.render("case-returned.njk", { title: "Case returned", c });
  } catch (e) {
    return next(e);
  }
});

// Timeline
app.get("/cases/:id/timeline", async (req, res, next) => {
  try {
    const c = await getCaseById(req.params.id);
    if (!c) return res.status(404).send("Not found");
    const events = await listCaseEvents(req.params.id);
    return res.render("case-timeline.njk", { title: "Timeline", c, events });
  } catch (e) {
    return next(e);
  }
});

// CSRF error handler
app.use((err, req, res, next) => {
  if (err.code === "EBADCSRFTOKEN") {
    return res.status(403).send("Invalid CSRF token. Refresh the page and try again.");
  }
  return next(err);
});

// Generic error handler (local dev)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).send(err.message || "Server error");
});

app.listen(port, () => {
  console.log(`Listening on http://localhost:${port}`);
});
