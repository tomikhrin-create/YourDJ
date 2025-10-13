// /api/lead.js — Minimal verze: jen Name, Email, Phone, Date, Venue, Note, UA, Referer
// Bez Start/End/Attendees/Type/Source (žádné single-selecty → žádné 422).

const AIRTABLE_URL = (base, table) =>
  `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}`;

// -------- Helpers --------
function addIfPresent(target, key, val) {
  if (val === undefined || val === null) return;
  if (typeof val === 'string' && val.trim() === '') return;
  target[key] = val;
}
function toAirtableDate(input) {
  if (!input) return undefined;
  const v = String(input).trim();
  if (!v) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;                 // YYYY-MM-DD
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(v)) {                        // DD.MM.YYYY
    const [dd, mm, yyyy] = v.split('.');
    return `${yyyy}-${mm}-${dd}`;
  }
  const d = new Date(v);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  return undefined;                                            // neznámý formát -> neposílat
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    body = body || {};

    // Honeypot
    if (body['bot-field']) return res.status(200).json({ ok: true, skipped: true });

    // Jméno (Name z first/last nebo name)
    const first = (body.first_name || '').trim();
    const last  = (body.last_name  || '').trim();
    const name  = (body.name && String(body.name).trim())
      ? String(body.name).trim()
      : [first, last].filter(Boolean).join(' ');

    // Složit fields (jen safe pole)
    const fields = {};
    addIfPresent(fields, 'Name',    name);
    addIfPresent(fields, 'Email',   body.email && String(body.email).trim() || undefined);
    addIfPresent(fields, 'Phone',   body.phone && String(body.phone).trim() || undefined);
    addIfPresent(fields, 'Date',    toAirtableDate(body.date));   // volitelné
    addIfPresent(fields, 'Venue',   body.venue);
    addIfPresent(fields, 'Note',    body.note);
    addIfPresent(fields, 'UA',      body.ua);
    addIfPresent(fields, 'Referer', body.referer);

    // ENV
    const baseId = (process.env.AIRTABLE_BASE_ID || '').split('/')[0];           // např. "appXXXX"
    const table  = (process.env.AIRTABLE_TABLE_NAME || 'Leads').split('/').pop(); // např. "Leads" nebo "tblXXXX"
    const key    = process.env.AIRTABLE_API_KEY;

    if (!baseId || !table || !key) {
      return res.status(500).json({
        ok: false,
        error: 'ENV_MISSING',
        missing: {
          AIRTABLE_BASE_ID: !baseId,
          AIRTABLE_TABLE_NAME: !table,
          AIRTABLE_API_KEY: !key,
        }
      });
    }

    // Odeslat do Airtable
    const r = await fetch(AIRTABLE_URL(baseId, table), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ records: [{ fields }] }),
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      console.error('AIRTABLE_ERROR', { status: r.status, details: data, payloadFields: fields });
      return res.status(500).json({ ok: false, error: 'AIRTABLE_ERROR', status: r.status, details: data });
    }

    return res.status(200).json({ ok: true, id: data.records?.[0]?.id || null });
  } catch (e) {
    console.error('SERVER_ERROR', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
};
