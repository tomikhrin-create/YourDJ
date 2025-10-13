// /api/lead.js — Minimal + TYPE se záložním textovým polem (nikdy nespadne na 422)

const AIRTABLE_URL = (base, table) =>
  `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}`;

// ------- Helpers -------
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
  return undefined;
}
function stripQuotes(s){ const v=(s||'').toString().trim(); if(!v) return ''; const a=v[0], b=v[v.length-1]; return ((a===b) && (a==='"'||a==="'")) ? v.slice(1,-1).trim() : v; }
function slugifyLower(s){ return (s||'').toString().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }

// Mapování běžných hodnot (pokud máš v selectu jiné labely, klidně uprav)
const TYPE_LABELS = {
  'svatebni-den':    'Svatební den',
  'firemni-vecirek': 'Firemní večírek',
  'narozeniny':      'Narozeniny',
  'konference':      'Konference',
  'verejna-akce':    'Veřejná akce',
};
function mapType(raw) {
  const incoming = stripQuotes(raw);
  if (!incoming) return { select: undefined, raw: undefined };
  // 1) pokud už přichází přesný label z Airtablu, pošli ho
  for (const label of Object.values(TYPE_LABELS)) {
    if (incoming === label) return { select: label, raw: incoming };
  }
  // 2) zkus slug → label
  const k = slugifyLower(incoming);
  if (TYPE_LABELS[k]) return { select: TYPE_LABELS[k], raw: incoming };
  // 3) jinak se pokusíme poslat to, co přišlo; když selže, uložíme do TypeText
  return { select: incoming, raw: incoming };
}

async function sendToAirtable({ baseId, table, key, fields }) {
  const r = await fetch(AIRTABLE_URL(baseId, table), {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: [{ fields }] }),
  });
  const data = await r.json().catch(() => ({}));
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

    // Jméno
    const first = (body.first_name || '').trim();
    const last  = (body.last_name  || '').trim();
    const name  = (body.name && String(body.name).trim())
      ? String(body.name).trim()
      : [first, last].filter(Boolean).join(' ');

    // Datum
    const atDate = toAirtableDate(body.date);

    // TYPE (mapování + raw)
    const { select: typeSelect, raw: typeRaw } = mapType(body.type);

    // ENV
    const baseId = (process.env.AIRTABLE_BASE_ID || '').split('/')[0];
    const table  = (process.env.AIRTABLE_TABLE_NAME || 'Leads').split('/').pop();
    const key    = process.env.AIRTABLE_API_KEY;
    if (!baseId || !table || !key) {
      return res.status(500).json({
        ok:false, error:'ENV_MISSING',
        missing:{ AIRTABLE_BASE_ID:!baseId, AIRTABLE_TABLE_NAME:!table, AIRTABLE_API_KEY:!key }
      });
    }

    // 1) pokus: poslat i single-select Type
    const fields1 = {};
    addIfPresent(fields1, 'Name',    name);
    addIfPresent(fields1, 'Email',   body.email && String(body.email).trim() || undefined);
    addIfPresent(fields1, 'Phone',   body.phone && String(body.phone).trim() || undefined);
    addIfPresent(fields1, 'Date',    atDate);
    addIfPresent(fields1, 'Venue',   body.venue);
    addIfPresent(fields1, 'Note',    body.note);
    addIfPresent(fields1, 'UA',      body.ua);
    addIfPresent(fields1, 'Referer', body.referer);
    addIfPresent(fields1, 'Type',    typeSelect); // může způsobit 422, když v selectu chybí možnost

    let { r, data } = await sendToAirtable({ baseId, table, key, fields: fields1 });

    // 422 invalid multiple choice -> pošleme znovu BEZ 'Type', ale s 'TypeText' = raw
    if (!r.ok && r.status === 422 && data?.error?.type === 'INVALID_MULTIPLE_CHOICE_OPTIONS') {
      const fields2 = {};
      addIfPresent(fields2, 'Name',    name);
      addIfPresent(fields2, 'Email',   body.email && String(body.email).trim() || undefined);
      addIfPresent(fields2, 'Phone',   body.phone && String(body.phone).trim() || undefined);
      addIfPresent(fields2, 'Date',    atDate);
      addIfPresent(fields2, 'Venue',   body.venue);
      addIfPresent(fields2, 'Note',    body.note);
      addIfPresent(fields2, 'UA',      body.ua);
      addIfPresent(fields2, 'Referer', body.referer);
      addIfPresent(fields2, 'TypeText', typeRaw || body.type || ''); // jistota: uložíme původní text do textového pole

      ({ r, data } = await sendToAirtable({ baseId, table, key, fields: fields2 }));
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
