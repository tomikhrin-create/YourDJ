// /api/lead.js — Vercel Serverless Function (Airtable)
// Fix 422: Start/End posíláme jako "YYYY-MM-DD HH:MM" složené z Date + start_time/end_time.
// Pokud Date chybí, Start/End vůbec neposíláme.

const AIRTABLE_URL = (base, table) =>
  `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}`;

// --- helpers ---
function toAirtableDate(input) {
  if (!input) return undefined;
  const v = String(input).trim();
  if (!v) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;           // YYYY-MM-DD
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(v)) {                  // DD.MM.YYYY -> YYYY-MM-DD
    const [dd, mm, yyyy] = v.split('.');
    return `${yyyy}-${mm}-${dd}`;
  }
  const d = new Date(v);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  return undefined;                                       // neznámý formát -> neposílat
}

function toHHMM(input) {
  if (!input) return undefined;
  const m = String(input).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return undefined;
  const h = Number(m[1]), min = Number(m[2]);
  if (Number.isNaN(h) || Number.isNaN(min) || h < 0 || h > 23 || min < 0 || min > 59) return undefined;
  return `${h.toString().padStart(2,'0')}:${min.toString().padStart(2,'0')}`;
}

function combineDateTime(dateVal, timeVal) {
  const d = toAirtableDate(dateVal);
  if (!d) return undefined;           // bez data neposílat Start/End
  const t = toHHMM(timeVal);
  if (!t) return d;                   // pokud není čas, pošli jen datum (když máš v Airtable Date-only)
  return `${d} ${t}`;                 // pro DateTime pole
}

function addIfPresent(obj, key, val) {
  if (val === undefined || val === null) return;
  if (typeof val === 'string' && val.trim() === '') return;
  obj[key] = val;
}

module.exports = async (req, res) => {
  // CORS
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

    // Jméno
    const first = (body.first_name || '').trim();
    const last  = (body.last_name  || '').trim();
    const name  = (body.name && String(body.name).trim())
      ? String(body.name).trim()
      : [first, last].filter(Boolean).join(' ');

    const fields = {};
    addIfPresent(fields, 'Name', name);
    addIfPresent(fields, 'Email', body.email);

    // Telefon (umožní i lokalizovaný název přes ENV)
    const phoneField = (process.env.AIRTABLE_PHONE_FIELD || 'Phone').trim();
    const phoneVal = (body.phone && String(body.phone).trim()) || undefined;
    addIfPresent(fields, phoneField, phoneVal);

    // Date + Start/End
    const atDate = toAirtableDate(body.date);
    addIfPresent(fields, 'Date', atDate);

    const startCombined = combineDateTime(body.date, body.start_time);
    addIfPresent(fields, 'Start', startCombined);

    const endCombined = combineDateTime(body.date, body.end_time);
    addIfPresent(fields, 'End', endCombined);

    // Další pole
    addIfPresent(fields, 'Venue', body.venue);
    addIfPresent(fields, 'Type', body.type);

    const attendees = body.attendees ? Number(body.attendees) : undefined;
    if (!Number.isNaN(attendees)) addIfPresent(fields, 'Attendees', attendees);

    addIfPresent(fields, 'Source', body.source);
    addIfPresent(fields, 'Note', body.note);
    addIfPresent(fields, 'UA', body.ua);
    addIfPresent(fields, 'Referer', body.referer);

    // ENV
    const baseId = (process.env.AIRTABLE_BASE_ID || '').split('/')[0];          // appXXXX
    const table  = (process.env.AIRTABLE_TABLE_NAME || 'Leads').split('/').pop();
    const key    = process.env.AIRTABLE_API_KEY;

    if (!baseId || !table || !key) {
      return res.status(500).json({ ok: false, error: 'ENV_MISSING', missing: {
        AIRTABLE_BASE_ID: !baseId,
        AIRTABLE_TABLE_NAME: !table,
        AIRTABLE_API_KEY: !key,
      }});
    }

    const r = await fetch(AIRTABLE_URL(baseId, table), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ records: [{ fields }] }),
    });

    const data = await r.json();

    if (!r.ok) {
      return res.status(500).json({ ok: false, error: 'AIRTABLE_ERROR', status: r.status, details: data });
    }

    return res.status(200).json({ ok: true, id: data.records?.[0]?.id || null });
  } catch {
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
};
