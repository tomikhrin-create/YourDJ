// /api/lead.js — Vercel Serverless Function (Airtable)
// - Skip empty values for Date/DateTime fields (Date/Start/End)
// - Start/End = Date + HH:MM (if time provided), otherwise just Date
// - Never send CreatedAt (computed in Airtable)

const AIRTABLE_URL = (base, table) =>
  `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}`;

const normalizeBaseId = (s) => (s || '').split('/')[0];
const normalizeTable = (s) => {
  if (!s) return 'Leads';
  const parts = String(s).split('/');
  return parts[parts.length - 1]; // table name or tbl...
};

function toAirtableDate(input) {
  if (!input) return undefined;
  const v = String(input).trim();
  if (!v) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v; // ISO YYYY-MM-DD
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(v)) {       // DD.MM.YYYY → YYYY-MM-DD
    const [dd, mm, yyyy] = v.split('.');
    return `${yyyy}-${mm}-${dd}`;
  }
  const d = new Date(v);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  return undefined;
}

function toHHMM(input) {
  if (!input) return undefined;
  const v = String(input).trim();
  if (!v) return undefined;
  const m = v.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return undefined;
  let h = Number(m[1]); let min = Number(m[2]);
  if (isNaN(h) || isNaN(min) || h < 0 || h > 23 || min < 0 || min > 59) return undefined;
  const hh = h < 10 ? `0${h}` : String(h);
  const mm = min < 10 ? `0${min}` : String(min);
  return `${hh}:${mm}`;
}

function combineDateTime(dateVal, timeVal) {
  const d = toAirtableDate(dateVal);
  if (!d) return undefined;     // no date => don't send anything
  const t = toHHMM(timeVal);
  if (!t) return d;             // only date
  return `${d} ${t}`;           // Airtable accepts "YYYY-MM-DD HH:MM"
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

    // Honeypot
    if (body['bot-field']) return res.status(200).json({ ok: true, skipped: true });

    const fields = {};
    const add = (k, val) => {
      if (val === undefined || val === null) return;
      if (typeof val === 'string' && val.trim() === '') return;
      fields[k] = val;
    };

    // Basic fields
    add('Name', body.name);
    add('Email', body.email);

    // Date (optional, only if valid)
    const atDate = toAirtableDate(body.date);
    if (atDate) add('Date', atDate);

    // Start/End combined
    const startCombined = combineDateTime(body.date, body.start_time);
    if (startCombined) add('Start', startCombined);

    const endCombined = combineDateTime(body.date, body.end_time);
    if (endCombined) add('End', endCombined);

    // Other optional fields
    add('Venue', body.venue);
    add('Type', body.type);
    const attendees = body.attendees ? Number(body.attendees) : undefined;
    if (attendees !== undefined && !Number.isNaN(attendees)) add('Attendees', attendees);
    add('Source', body.source);
    add('Note', body.note);
    add('UA', body.ua);
    add('Referer', body.referer);
    // Do NOT send CreatedAt (computed)

    const baseId = normalizeBaseId(process.env.AIRTABLE_BASE_ID);
    const table  = normalizeTable(process.env.AIRTABLE_TABLE_NAME);
    const key    = process.env.AIRTABLE_API_KEY;

    if (!baseId || !table || !key) {
      return res.status(500).json({ ok:false, error:'ENV_MISSING', missing:{
        AIRTABLE_BASE_ID: !baseId, AIRTABLE_TABLE_NAME: !table, AIRTABLE_API_KEY: !key
      }});
    }

    const r = await fetch(AIRTABLE_URL(baseId, table), {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [{ fields }] }),
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(500).json({ ok:false, error:'AIRTABLE_ERROR', status:r.status, details:data });
    }

    return res.status(200).json({ ok:true, id: data.records?.[0]?.id || null });
  } catch (e) {
    return res.status(500).json({ ok:false, error:'SERVER_ERROR' });
  }
};
