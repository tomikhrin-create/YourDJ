// /api/lead.js — Airtable lead + fallback bez Type/Source při 422 (INVALID_MULTIPLE_CHOICE_OPTIONS)

const AIRTABLE_URL = (base, table) =>
  `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}`;

// ====== Sloupce (případně změň přes ENV) ======
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

// ====== Mapování hodnot (můžeš rozšířit podle svých labelů v Airtablu) ======
const TYPE_LABELS = {
  'svatebni-den':    'Svatební den',
  'firemni-vecirek': 'Firemní večírek',
  'narozeniny':      'Narozeniny',
  'konference':      'Konference',
  'verejna-akce':    'Veřejná akce',
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(v)) { const [dd, mm, yyyy] = v.split('.'); return `${yyyy}-${mm}-${dd}`; }
  const d = new Date(v);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  return undefined;
}
function toHHMM(input) {
  if (!input) return undefined;
  let v = String(input).trim();
  const mSS = v.match(/^(\d{1,2}):(\d{2}):(\d{2})$/); if (mSS) v = `${mSS[1]}:${mSS[2]}`;
  const m = v.match(/^(\d{1,2}):(\d{2})$/); if (!m) return undefined;
  const h = +m[1], min = +m[2];
  if (h<0 || h>23 || min<0 || min>59) return undefined;
  return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
}
function composeDateOrDateTime(dateVal, timeVal, dateOnly) {
  const d = toAirtableDate(dateVal); if (!d) return undefined;
  if (dateOnly) return d;
  const t = toHHMM(timeVal); return t ? `${d} ${t}` : d;
}
function stripQuotes(s){ const v=(s||'').toString().trim(); if(!v) return ''; const a=v[0], b=v[v.length-1]; return ((a===b) && (a==='"'||a==="'")) ? v.slice(1,-1).trim() : v; }
function slugifyLower(s){ return (s||'').toString().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
function mapSelectValue(raw, map){
  const incoming = stripQuotes(raw);
  if (!incoming) return undefined;
  // 1) už je to přesný label?
  for (const label of Object.values(map)) if (incoming === label) return label;
  // 2) pošli mapped label dle slugu (např. 'svatebni-den' -> 'Svatební den')
  const k = slugifyLower(incoming);
  if (map[k]) return map[k];
  // 3) poslední šance: pošli přímo to, co přišlo (pokud to přesně existuje v Airtablu, projde; jinak fallback to zachytí)
  return incoming;
}

async function sendToAirtable({baseId, table, key, fields}) {
  const r = await fetch(AIRTABLE_URL(baseId, table), {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: [{ fields }] }),
  });
  const data = await r.json().catch(()=> ({}));
  return { r, data };
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'METHOD_NOT_ALLOWED' });

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    if (body['bot-field']) return res.status(200).json({ ok:true, skipped:true });

    // Name
    const first = (body.first_name||'').trim();
    const last  = (body.last_name||'').trim();
    const name  = (body.name && String(body.name).trim()) ? String(body.name).trim() : [first,last].filter(Boolean).join(' ');

    // Date/Time
    const atDate        = toAirtableDate(body.date);
    const startDateOnly = String(process.env.AIRTABLE_START_IS_DATE_ONLY||'').trim()==='1';
    const endDateOnly   = String(process.env.AIRTABLE_END_IS_DATE_ONLY||'').trim()==='1';
    const startVal      = composeDateOrDateTime(body.date, body.start_time, startDateOnly);
    const endVal        = composeDateOrDateTime(body.date, body.end_time,   endDateOnly);

    // Selecty
    let typeVal   = mapSelectValue(body.type,   TYPE_LABELS);
    let sourceVal = mapSelectValue(body.source, SOURCE_LABELS);

    // ENV
    const baseId = (process.env.AIRTABLE_BASE_ID || '').split('/')[0];
    const table  = (process.env.AIRTABLE_TABLE_NAME || 'Leads').split('/').pop();
    const key    = process.env.AIRTABLE_API_KEY;
    if (!baseId || !table || !key) {
      return res.status(500).json({ ok:false, error:'ENV_MISSING',
        missing:{ AIRTABLE_BASE_ID:!baseId, AIRTABLE_TABLE_NAME:!table, AIRTABLE_API_KEY:!key } });
    }

    // Fields
    const makeFields = (omit = {}) => {
      const f = {};
      addIfPresent(f, FIELDS.NAME,    name);
      addIfPresent(f, FIELDS.EMAIL,   body.email && String(body.email).trim() || undefined);
      addIfPresent(f, FIELDS.PHONE,   body.phone && String(body.phone).trim() || undefined);
      addIfPresent(f, FIELDS.DATE,    atDate);
      addIfPresent(f, FIELDS.START,   startVal);
      addIfPresent(f, FIELDS.END,     endVal);
      addIfPresent(f, FIELDS.VENUE,   body.venue);
      if (!omit[FIELDS.TYPE])   addIfPresent(f, FIELDS.TYPE,   typeVal);
      if (!omit[FIELDS.SOURCE]) addIfPresent(f, FIELDS.SOURCE, sourceVal);
      addIfPresent(f, FIELDS.NOTE,    body.note);
      addIfPresent(f, FIELDS.UA,      body.ua);
      addIfPresent(f, FIELDS.REFERER, body.referer);
      return f;
    };

    // 1. pokus (se selecty)
    let { r, data } = await sendToAirtable({ baseId, table, key, fields: makeFields() });

    // Pokud Airtable odmítne vytvořit novou možnost, zkusíme to bez problematického pole/í
    const isInvalidOption422 = (!r.ok && r.status === 422 && data?.error?.type === 'INVALID_MULTIPLE_CHOICE_OPTIONS');
    if (isInvalidOption422) {
      // heuristika: zpráva obsahuje název pole; zkusíme odříznout TYPE/SOURCE
      const msg = (data?.error?.message || '').toLowerCase();
      const omit = {};
      if (msg.includes(`"${FIELDS.TYPE.toLowerCase()}"`) || msg.includes('field type'))   omit[FIELDS.TYPE] = true;
      if (msg.includes(`"${FIELDS.SOURCE.toLowerCase()}"`) || msg.includes('field source')) omit[FIELDS.SOURCE] = true;
      // kdyby nebylo jasné, prostě vynecháme obě (půjde to uložit bez nich)
      if (Object.keys(omit).length === 0) { omit[FIELDS.TYPE] = true; omit[FIELDS.SOURCE] = true; }

      ({ r, data } = await sendToAirtable({ baseId, table, key, fields: makeFields(omit) }));
    }

    if (!r.ok) {
      console.error('AIRTABLE_ERROR', { status:r.status, details:data });
      return res.status(500).json({ ok:false, error:'AIRTABLE_ERROR', status:r.status, details:data });
    }

    return res.status(200).json({ ok:true, id: data.records?.[0]?.id || null });
  } catch (e) {
    console.error('SERVER_ERROR', e);
    return res.status(500).json({ ok:false, error:'SERVER_ERROR' });
  }
};
