// /api/lead.js — Vercel Serverless Function (Airtable, robustní verze)
// - Mapování názvů sloupců přes ENV (viz FIELDS)
// - Odolné proti 422/500: posílá jen neprázdné hodnoty, validuje datum/čas
// - Podpora Date-only sloupců pro Start/End přes ENV přepínače
// - Normalizace "type" (volitelné) + whitelist (volitelné, viz TYPE_LABELS)
// - CORS + OPTIONS

const AIRTABLE_URL = (base, table) =>
  `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}`;

// ---------- Field name mapping (override přes ENV) ----------
const FIELDS = {
  NAME:        process.env.AIRTABLE_NAME_FIELD        || 'Name',
  EMAIL:       process.env.AIRTABLE_EMAIL_FIELD       || 'Email',
  PHONE:       (process.env.AIRTABLE_PHONE_FIELD      || 'Phone').trim(), // držíme kompatibilitu s pův. proměnnou
  DATE:        process.env.AIRTABLE_DATE_FIELD        || 'Date',
  START:       process.env.AIRTABLE_START_FIELD       || 'Start',
  END:         process.env.AIRTABLE_END_FIELD         || 'End',
  VENUE:       process.env.AIRTABLE_VENUE_FIELD       || 'Venue',
  TYPE:        process.env.AIRTABLE_TYPE_FIELD        || 'Type', // ← přesměruj na text/select pole (např. EventType)
  ATTENDEES:   process.env.AIRTABLE_ATTENDEES_FIELD   || 'Attendees',
  SOURCE:      process.env.AIRTABLE_SOURCE_FIELD      || 'Source',
  NOTE:        process.env.AIRTABLE_NOTE_FIELD        || 'Note',
  UA:          process.env.AIRTABLE_UA_FIELD          || 'UA',
  REFERER:     process.env.AIRTABLE_REFERER_FIELD     || 'Referer',
};

// ---------- Volitelný mapping/whitelist pro TYPE ----------
const TYPE_LABELS = {
  'svatebni-den': 'svatebni-den',
  'firemni-vecirek': 'firemni-vecirek',
  'narozeniny': 'narozeniny',
  'konference': 'konference',
  'verejna-akce': 'verejna-akce',
};
// když je whitelist zapnutý, pošleme jen hodnotu ze seznamu (jinak undefined)
const ENFORCE_TYPE_WHITELIST = false;

// ---------- helpers ----------
function addIfPresent(target, key, val) {
  if (val === undefined || val === null) return;
  if (typeof val === 'string' && val.trim() === '') return;
  target[key] = val;
}

function toAirtableDate(input) {
  if (!input) return undefined;
  const v = String(input).trim();
  if (!v) return undefined;

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;

  // DD.MM.YYYY -> YYYY-MM-DD
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(v)) {
    const [dd, mm, yyyy] = v.split('.');
    return `${yyyy}-${mm}-${dd}`;
  }

  // Fallback: Date parse (poslední možnost)
  const d = new Date(v);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  return undefined; // neznámý formát -> neposílat
}

// přijme "HH:MM" i "HH:MM:SS" a vrátí "HH:MM"
function toHHMM(input) {
  if (!input) return undefined;
  let v = String(input).trim();

  // HH:MM:SS -> usekni sekundy
  const secMatch = v.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (secMatch) v = `${secMatch[1]}:${secMatch[2]}`;

  const m = v.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);

  // Airtable nebere 24:00, jen 00:00..23:59
  if (Number.isNaN(h) || Number.isNaN(min) || h < 0 || h > 23 || min < 0 || min > 59) return undefined;
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
}

// dateOnly=true → jen YYYY-MM-DD; jinak YYYY-MM-DD HH:MM (když je čas)
function composeDateOrDateTime(dateVal, timeVal, dateOnly) {
  const d = toAirtableDate(dateVal);
  if (!d) return undefined; // bez data neposílej Start/End vůbec
  if (dateOnly) return d;   // sloupec v Airtable je Date (bez času)
  const t = toHHMM(timeVal);
  if (!t) return d;         // není čas → pošli jen datum
  return `${d} ${t}`;       // DateTime
}

function normalizeType(raw) {
  const v = (raw || '').toString().trim();
  if (!v) return undefined;
  if (!ENFORCE_TYPE_WHITELIST) return v;
  return TYPE_LABELS[v] || undefined;
}

module.exports = async (req, res) => {
  // --- CORS ---
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    body = body || {};

    // Honeypot
    if (body['bot-field']) {
      return res.status(200).json({ ok: true, skipped: true });
    }

    // Sestav Name (preferuj 'name', jinak slož z first/last)
    const first = (body.first_name || '').trim();
    const last  = (body.last_name  || '').trim();
    const name  = (body.name && String(body.name).trim())
      ? String(body.name).trim()
      : [first, last].filter(Boolean).join(' ');

    // Datum/čas – respektuj date-only přepínače
    const atDate = toAirtableDate(body.date);
    const startDateOnly = String(process.env.AIRTABLE_START_IS_DATE_ONLY || '').trim() === '1';
    const endDateOnly   = String(process.env.AIRTABLE_END_IS_DATE_ONLY   || '').trim() === '1';

    const startVal = composeDateOrDateTime(body.date, body.start_time, startDateOnly);
    const endVal   = composeDateOrDateTime(body.date, body.end_time,   endDateOnly);

    // Normalizace type
    const typeVal = normalizeType(body.type);

    // Skládání fields (posílej jen neprázdné)
    const fields = {};
    addIfPresent(fields, FIELDS.NAME, name);
    addIfPresent(fields, FIELDS.EMAIL, body.email && String(body.email).trim() || undefined);
    addIfPresent(fields, FIELDS.PHONE, body.phone && String(body.phone).trim() || undefined);

    addIfPresent(fields, FIELDS.DATE, atDate);
    addIfPresent(fields, FIELDS.START, startVal);
    addIfPresent(fields, FIELDS.END,   endVal);

    addIfPresent(fields, FIELDS.VENUE, body.venue);
    addIfPresent(fields, FIELDS.TYPE,  typeVal);

    const attendees = body.attendees ? Number(body.attendees) : undefined;
    if (attendees !== undefined && !Number.isNaN(attendees)) {
      addIfPresent(fields, FIELDS.ATTENDEES, attendees);
    }

    addIfPresent(fields, FIELDS.SOURCE,  body.source);
    addIfPresent(fields, FIELDS.NOTE,    body.note);
    addIfPresent(fields, FIELDS.UA,      body.ua);
    addIfPresent(fields, FIELDS.REFERER, body.referer);

    // ENV
    const baseId = (process.env.AIRTABLE_BASE_ID || '').split('/')[0];            // "appXXXX"
    const table  = (process.env.AIRTABLE_TABLE_NAME || 'Leads').split('/').pop(); // "Leads" nebo "tblXXXX"
    const key    = process.env.AIRTABLE_API_KEY;

    if (!baseId || !table || !key) {
      return res.status(500).json({
        ok: false,
        error: 'ENV_MISSING',
        missing: {
          AIRTABLE_BASE_ID:   !baseId,
          AIRTABLE_TABLE_NAME:!table,
          AIRTABLE_API_KEY:   !key,
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
      // Užitečné logování do Vercel logs, ať hned vidíš, které pole zlobí
      console.error('AIRTABLE_ERROR', {
        status: r.status,
        details: data,
        payloadFields: fields
      });

      return res.status(500).json({
        ok: false,
        error: 'AIRTABLE_ERROR',
        status: r.status,
        details: data
      });
    }

    return res.status(200).json({ ok: true, id: data.records?.[0]?.id || null });
  } catch (e) {
    console.error('SERVER_ERROR', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
};
