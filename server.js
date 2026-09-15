const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_PATH = path.join(__dirname, 'data', 'store.json');

function readDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}
function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}
function nextId(arr) {
  return arr.length ? Math.max(...arr.map((x) => x.id)) + 1 : 1;
}
function clampLevel(n) {
  return Math.min(5, Math.max(1, Number(n) || 1));
}

// ---------- Opportunities ----------

// List all opportunities (student browsing view)
app.get('/api/opportunities', (req, res) => {
  const db = readDB();
  res.json(db.opportunities);
});

// Get a single opportunity
app.get('/api/opportunities/:id', (req, res) => {
  const db = readDB();
  const opp = db.opportunities.find((o) => o.id === +req.params.id);
  if (!opp) return res.status(404).json({ error: 'Opportunity not found' });
  res.json(opp);
});

// Industry posts a new opportunity with required skills + proficiency levels (1-5)
app.post('/api/opportunities', (req, res) => {
  const { title, company, description, location, type, skills } = req.body;

  if (!title || !company || !Array.isArray(skills) || skills.length === 0) {
    return res.status(400).json({ error: 'title, company and at least one skill are required' });
  }

  const cleanSkills = skills
    .map((s) => ({ name: String(s.name || '').trim(), level: clampLevel(s.level) }))
    .filter((s) => s.name);

  if (cleanSkills.length === 0) {
    return res.status(400).json({ error: 'Each skill needs a name and a level from 1-5' });
  }

  const db = readDB();
  const opp = {
    id: nextId(db.opportunities),
    title,
    company,
    description: description || '',
    location: location || '',
    type: type || 'Internship',
    skills: cleanSkills,
    createdAt: new Date().toISOString(),
  };
  db.opportunities.unshift(opp);
  writeDB(db);
  res.status(201).json(opp);
});

// ---------- Applications ----------

// Student applies to an opportunity, self-rating each required skill (1-5)
app.post('/api/opportunities/:id/applications', (req, res) => {
  const db = readDB();
  const opp = db.opportunities.find((o) => o.id === +req.params.id);
  if (!opp) return res.status(404).json({ error: 'Opportunity not found' });

  const { studentName, email, note, skills } = req.body;
  if (!studentName || !email || !Array.isArray(skills)) {
    return res.status(400).json({ error: 'studentName, email and skills are required' });
  }

  const ratingsByName = {};
  skills.forEach((s) => {
    if (s && s.name) ratingsByName[String(s.name).trim()] = clampLevel(s.rating);
  });

  // Score only against the skills the opportunity actually asked for
  const scored = opp.skills.map((req) => {
    const self = ratingsByName[req.name] || 0;
    return { name: req.name, required: req.level, selfRating: self };
  });

  const matchScore = Math.round(
    (scored.reduce((sum, s) => sum + Math.min(s.selfRating / s.required, 1), 0) / scored.length) * 100
  );

  const application = {
    id: nextId(db.applications),
    opportunityId: opp.id,
    studentName,
    email,
    note: note || '',
    skills: scored,
    matchScore,
    status: 'Submitted',
    createdAt: new Date().toISOString(),
  };

  db.applications.unshift(application);
  writeDB(db);
  res.status(201).json(application);
});

// Industry views all applications for one of their opportunities, best match first
app.get('/api/opportunities/:id/applications', (req, res) => {
  const db = readDB();
  const opp = db.opportunities.find((o) => o.id === +req.params.id);
  if (!opp) return res.status(404).json({ error: 'Opportunity not found' });
  const apps = db.applications
    .filter((a) => a.opportunityId === opp.id)
    .sort((a, b) => b.matchScore - a.matchScore);
  res.json(apps);
});

// Student views their own applications (with opportunity details attached)
app.get('/api/applications', (req, res) => {
  const db = readDB();
  let apps = db.applications;
  if (req.query.email) apps = apps.filter((a) => a.email === req.query.email);
  const withOpp = apps.map((a) => ({
    ...a,
    opportunity: db.opportunities.find((o) => o.id === a.opportunityId) || null,
  }));
  res.json(withOpp);
});

// Industry shortlists or rejects an application
app.patch('/api/applications/:id', (req, res) => {
  const db = readDB();
  const application = db.applications.find((a) => a.id === +req.params.id);
  if (!application) return res.status(404).json({ error: 'Application not found' });

  const { status } = req.body;
  if (!['Submitted', 'Shortlisted', 'Rejected'].includes(status)) {
    return res.status(400).json({ error: 'status must be Submitted, Shortlisted or Rejected' });
  }
  application.status = status;
  writeDB(db);
  res.json(application);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`SkillBridge backend running at http://localhost:${PORT}`));
