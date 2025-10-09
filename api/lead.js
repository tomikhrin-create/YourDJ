// /api/lead.js — Vercel Serverless Function (Airtable)
//
// Odolné proti 422/500:
// - Start/End posíláme jako "YYYY-MM-DD HH:MM" (nebo jen "YYYY-MM-DD" dle ENV)
// - Pokud chybí Date, Start/End se NEPOSÍLAJÍ
// - Akceptuje čas i ve tvaru "HH:MM:SS" (ořízne na HH:MM)
// - Neposílá prázdné hodnoty
// - AIRTABLE_PHONE_FIELD umožní jiný název sloupce pro telefon
// - Přepínače pro Date-only sloupce:
//     AIRTABLE_START_IS_DATE_ONLY=1
//     AIRTABLE_END_IS_DATE_ONLY=1

const AIRTABLE_URL = (base, table) =>
  `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}`;

// --- helpers ---
function toAirtableDate(input) {
  if (!input) return undefined;
  const v = String(input).trim();
  if (!v) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;                 // YYYY-MM-DD
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(v)) {                        // DD.MM.YYYY -> YYYY-MM-DD
    const [dd, mm, yyyy] = v.split('.');
    return `${yyyy}-${mm}-${dd}`;
  }
  const d = new Date(v);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  return undefined;                                            // neznámý formát -> neposílat
}

// přijme "HH:MM" i "HH:MM:SS" a vrátí "HH:MM"
function toHHMM(input) {
  if (!input) return undefined;
  let v = String(input).trim();
  // pokud je "HH:MM:SS", uřízni sekundy
  const secMatch = v.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (secMatch) {
    v = `${secMatch[1]}:${secMatch[2]}`;
  }
  const m = v.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  // 24:00 není validní čas pro Airtable – odmítněme
  if (Number.isNaN(h) || Number.isNaN(min) || h < 0 || h > 23 || min < 0 || min > 59) return undefined;
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
}

// dateOnly=true → jen YYYY-MM-DD; jinak YYYY-MM-DD HH:MM (když je čas)
function composeDateOrDateTime(dateVal, timeVal, dateOnly) {
  const d = toAirtableDate(dateVal);
  if (!d) return undefined;             // bez data neposílej Start/End vůbec
  if (dateOnly) return d;               // sloupec v Airtable je Date (bez času)
  const t = toHHMM(timeVal);
  if (!t) return d;                     // není čas → pošli jen datum (OK i pro Date-only)
  return `${d} ${t}`;                   // DateTime
}

function addIfPresent(target, key, val) {
  if (val === undefined || val === null) return;
  if (typeof val === 'string' && val.trim() === '') return;
  target[key] = val;
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
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    // Honeypot
    if (body['bot-field']) return res.status(200).json({ ok: true, skipped: true });

    // Sestav pole
    const fields = {};

    // Jméno: preferuj 'name', jinak slož z first/last
    const first = (body.first_name || '').trim();
    const last  = (body.last_name || '').trim();
    const name  = (body.name && String(body.name).trim())
      ? String(body.name).trim()
      : [first, last].filter(Boolean).join(' ');
    addIfPresent(fields, 'Name', name);

    // Kontakty
    addIfPresent(fields, 'Email', body.email);
    const phoneField = (process.env.AIRTABLE_PHONE_FIELD || 'Phone').trim();
    addIfPresent(fields, phoneField, (body.phone && String(body.phone).trim()) || undefined);

    // Datum + Start/End (respektuje Date-only přepínače)
    const atDate = toAirtableDate(body.date);
    addIfPresent(fields, 'Date', atDate);

    const startDateOnly = String(process.env.AIRTABLE_START_IS_DATE_ONLY || '').trim() === '1';
    const endDateOnly   = String(process.env.AIRTABLE_END_IS_DATE_ONLY || '').trim() === '1';

    const startVal = composeDateOrDateTime(body.date, body.start_time, startDateOnly);
    addIfPresent(fields, 'Start', startVal);

    const endVal = composeDateOrDateTime(body.date, body.end_time, endDateOnly);
    addIfPresent(fields, 'End', endVal);

    // Ostatní
    addIfPresent(fields, 'Venue', body.venue);
    addIfPresent(fields, 'Type', body.type);

    const attendees = body.attendees ? Number(body.attendees) : undefined;
    if (attendees !== undefined && !Number.isNaN(attendees)) addIfPresent(fields, 'Attendees', attendees);

    addIfPresent(fields, 'Source', body.source);
    addIfPresent(fields, 'Note', body.note);
    addIfPresent(fields, 'UA', body.ua);
    addIfPresent(fields, 'Referer', body.referer);

    // ENV
    const baseId = (process.env.AIRTABLE_BASE_ID || '').split('/')[0];       // "appXXXX"
    const table  = (process.env.AIRTABLE_TABLE_NAME || 'Leads').split('/').pop(); // "Leads" nebo "tblXXXX"
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

    // Odeslání do Airtable
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
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
};
