// /api/lead.js — Vercel Serverless Function → Airtable (oprava pořadí, validace selectů, bez Attendees)

const AIRTABLE_URL = (base, table) =>
  `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}`;

// ====== Mapa názvů sloupců (přizpůsobitelné přes ENV) ======
const FIELDS = {
  NAME:     process.env.AIRTABLE_NAME_FIELD     || 'Name',
  EMAIL:    process.env.AIRTABLE_EMAIL_FIELD    || 'Email',
  PHONE:    (process.env.AIRTABLE_PHONE_FIELD   || 'Phone').trim(),
  DATE:     process.env.AIRTABLE_DATE_FIELD     || 'Date',
  START:    process.env.AIRTABLE_START_FIELD    || 'Start',
  END:      process.env.AIRTABLE_END_FIELD      || 'End',
  VENUE:    process.env.AIRTABLE_VENUE_FIELD    || 'Venue',
  TYPE:     process.env.AIRTABLE_TYPE_FIELD     || 'Type',     // Single select
  SOURCE:   process.env.AIRTABLE_SOURCE_FIELD   || 'Source',   // Single select
  NOTE:     process.env.AIRTABLE_NOTE_FIELD     || 'Note',
  UA:       process.env.AIRTABLE_UA_FIELD       || 'UA',
  REFERER:  process.env.AIRTABLE_REFERER_FIELD  || 'Referer',
};

// ====== Přípustné hodnoty pro Single-select (přizpůsob podle Airtablu) ======
const TYPE_LABELS = {
  'svatebni-den':    'Svatební den',
  'firemni-vecirek': 'Firemní večírek',
  'narozeniny':      'Narozeniny',
  'konference':      'Konference',
  'verejna-akce':    'Veřejná akce',
  // rezerva: pokud v Airtablu máš náhodou varianty s velkým písmenem / koncovou mezerou,
  // můžeš je přidat jako další mapované hodnoty na stejné labely.
};

const SOURCE_LABELS = {
  'facebook':   'Facebook',
  'instagram':  'Instagram',
  'google':     'Google',
  'doporučení': 'Doporučení',
  'doporučeni': 'Doporučení',
  'vystava':    'Výstava',
  'výstava':    'Výstava',
  'linkenid':   'LinkenID',
};

// ====== Helpers ======
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
function toHHMM(input) {
  if (!input) return undefined;
  let v = String(input).trim();
  const secMatch = v.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);      // HH:MM:SS -> HH:MM
  if (secMatch) v = `${secMatch[1]}:${secMatch[2]}`;
  const m = v.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (Number.isNaN(h) || Number.isNaN(min) || h < 0 || h > 23 || min < 0 || min > 59) return undefined;
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
}
function composeDateOrDateTime(dateVal, timeVal, dateOnly) {
  const d = toAirtableDate(dateVal);
  if (!d) return undefined;
  if (dateOnly) return d;                // sloupec je Date-only v Airtable
  const t = toHHMM(timeVal);
  return t ? `${d} ${t}` : d;            // pokud není čas, pošli jen datum
}
function stripQuotes(s) {
  const v = (s || '').toString().trim();
  if (!v) return '';
  const q1=v[0], q2=v[v.length-1];
  if ((q1==='"'&&q2==='"') || (q1==="'"&&q2==="'" )) return v.slice(1,-1).trim();
  return v;
}
function slugifyLower(s) {
  return (s||'')
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g,'')   // odstranění diakritiky
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'');
}
function mapSelectValue(raw, map) {
  const incoming = stripQuotes(raw);
  if (!incoming) return undefined;
  // přesný match (kdyby už chodil label)
  for (const label of Object.values(map)) {
    if (incoming === label) return label;
  }
  // slug match
  const k = slugifyLower(incoming);
  return map[k]; // může být undefined -> pole se nepošle
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

    // honeypot
    if (body['bot-field']) return res.status(200).json({ ok: true, skipped: true });

    // Name
    const first = (body.first_name || '').trim();
    const last  = (body.last_name  || '').trim();
    const name  = (body.name && String(body.name).trim())
      ? String(body.name).trim()
      : [first, last].filter(Boolean).join(' ');

    // Date/Time
    const atDate        = toAirtableDate(body.date);
    const startDateOnly = String(process.env.AIRTABLE_START_IS_DATE_ONLY || '').trim() === '1';
    const endDateOnly   = String(process.env.AIRTABLE_END_IS_DATE_ONLY   || '').trim() === '1';
    const startVal      = composeDateOrDateTime(body.date, body.start_time, startDateOnly);
    const endVal        = composeDateOrDateTime(body.date, body.end_time,   endDateOnly);

    // Single-select mapování (nepošleme nic, když hodnota nesedí)
    const typeVal   = mapSelectValue(body.type,   TYPE_LABELS);
    const sourceVal = mapSelectValue(body.source, SOURCE_LABELS);

    // Poskládání fields (POZOR: teď už existuje 'startVal','endVal' a 'fields' až teď!)
    const fields = {};
    addIfPresent(fields, FIELDS.NAME,    name);
    addIfPresent(fields, FIELDS.EMAIL,   body.email && String(body.email).trim() || undefined);
    addIfPresent(fields, FIELDS.PHONE,   body.phone && String(body.phone).trim() || undefined);
    addIfPresent(fields, FIELDS.DATE,    atDate);
    addIfPresent(fields, FIELDS.START,   startVal);
    addIfPresent(fields, FIELDS.END,     endVal);
    addIfPresent(fields, FIELDS.VENUE,   body.venue);
    addIfPresent(fields, FIELDS.TYPE,    typeVal);
    addIfPresent(fields, FIELDS.SOURCE,  sourceVal);
    addIfPresent(fields, FIELDS.NOTE,    body.note);
    addIfPresent(fields, FIELDS.UA,      body.ua);
    addIfPresent(fields, FIELDS.REFERER, body.referer);

    // ENV
    const baseId = (process.env.AIRTABLE_BASE_ID || '').split('/')[0];
    const table  = (process.env.AIRTABLE_TABLE_NAME || 'Leads').split('/').pop();
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

    const data = await r.json().catch(() => ({})); // ochrana když Airtable vrátí prázdno

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
