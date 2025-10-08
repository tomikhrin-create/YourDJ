// /api/lead.js — Vercel Serverless Function (Airtable)
// - CORS + OPTIONS
// - Bez duplicit; jediný module.exports
// - Neposílá prázdné hodnoty (hl. Date/Start/End)
// - Start/End = Date + HH:MM (pokud je čas vyplněn)
// - NIKDY neposílá CreatedAt (v Airtable je computed)
// - Toleruje ENV ve tvaru "app.../tbl..." nebo "app.../shr..." (vezme jen první/poslední segment)

const AIRTABLE_URL = (base, table) =>
  `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}`;

const normalizeBaseId = (s) => (s || '').split('/')[0]; // "appXXXX[/...]" -> "appXXXX"
const normalizeTable = (s) => {
  if (!s) return 'Leads';
  const parts = String(s).split('/');
  return parts[parts.length - 1]; // "Leads" nebo "tblXXXX"
};

function toAirtableDate(input) {
  if (!input) return undefined;
  const v = String(input).trim();
  if (!v) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;             // YYYY-MM-DD
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(v)) {                    // DD.MM.YYYY -> YYYY-MM-DD
    const [dd, mm, yyyy] = v.split('.');
    return `${yyyy}-${mm}-${dd}`;
  }
  const d = new Date(v);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);       // ISO date only
  return undefined;                                         // neznámý formát -> neposílat
}

function toHHMM(input) {
  if (!input) return undefined;
  const v = String(input).trim();
  if (!v) return undefined;
  const m = v.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return undefined;
  const h = Number(m[1]), min = Number(m[2]);
  if (Number.isNaN(h) || Number.isNaN(min) || h < 0 || h > 23 || min < 0 || min > 59) return undefined;
  const hh = h < 10 ? `0${h}` : String(h);
  const mm = min < 10 ? `0${min}` : String(min);
  return `${hh}:${mm}`;
}

function combineDateTime(dateVal, timeVal) {
  const d = toAirtableDate(dateVal);
  if (!d) return undefined;              // bez data neposílej (DateTime pole by spadlo)
  const t = toHHMM(timeVal);
  if (!t) return d;                      // jen datum (pro Date pole OK)
  return `${d} ${t}`;                    // Airtable DateTime akceptuje "YYYY-MM-DD HH:MM"
}

// Přidá klíč pouze pokud má hodnotu (neprázdný string / validní hodnota)
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

    // Anti-spam honeypot
    if (body['bot-field']) return res.status(200).json({ ok: true, skipped: true });

    // Jméno: preferuj `name`; pokud není, slož z `first_name` + `last_name`
    const first = (body.first_name || '').trim();
    const last  = (body.last_name  || '').trim();
    const name  = (body.name && String(body.name).trim())
      ? String(body.name).trim()
      : [first, last].filter(Boolean).join(' ');

    // Sestavení fields — pouze hodnoty, které dávají smysl
    const fields = {};
    addIfPresent(fields, 'Name', name);
    addIfPresent(fields, 'Email', body.email);
    addIfPresent(fields, 'Phone', (body.phone && String(body.phone).trim()) || undefined);

    // Datum + časy
    const atDate = toAirtableDate(body.date);
    if (atDate) addIfPresent(fields, 'Date', atDate);

    const startCombined = combineDateTime(body.date, body.start_time);
    if (startCombined) addIfPresent(fields, 'Start', startCombined);

    const endCombined = combineDateTime(body.date, body.end_time);
    if (endCombined) addIfPresent(fields, 'End', endCombined);

    // Další volitelná pole
    addIfPresent(fields, 'Venue', body.venue);
    addIfPresent(fields, 'Type', body.type);

    const attendees = body.attendees ? Number(body.attendees) : undefined;
    if (attendees !== undefined && !Number.isNaN(attendees)) addIfPresent(fields, 'Attendees', attendees);

    addIfPresent(fields, 'Source', body.source);
    addIfPresent(fields, 'Note', body.note);
    addIfPresent(fields, 'UA', body.ua);
    addIfPresent(fields, 'Referer', body.referer);
    // POZOR: CreatedAt NEPOSÍLÁME (Airtable "Created time" je computed)

    // ENV
    const baseId = normalizeBaseId(process.env.AIRTABLE_BASE_ID);
    const table  = normalizeTable(process.env.AIRTABLE_TABLE_NAME);
    const key    = process.env.AIRTABLE_API_KEY;

    if (!baseId || !table || !key) {
      return res.status(500).json({
        ok: false,
        error: 'ENV_MISSING',
        missing: {
          AIRTABLE_BASE_ID: !baseId,
          AIRTABLE_TABLE_NAME: !table,
          AIRTABLE_API_KEY: !key,
        },
      });
    }

    // Zápis do Airtable
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
      return res.status(500).json({
        ok: false,
        error: 'AIRTABLE_ERROR',
        status: r.status,
        details: data,
      });
    }

    return res.status(200).json({
      ok: true,
      id: data.records?.[0]?.id || null,
    });
  } catch {
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
};
