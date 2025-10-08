// /api/lead.js — Vercel Serverless Function (Airtable)
// Jediná verze souboru (bez duplicit). Ošetřuje prázdná pole a datumy.

const AIRTABLE_URL = (base, table) =>
  `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}`;

// Pomocné funkce — odolné vůči chybnému formátu v ENV a datumům z formuláře
const normalizeBaseId = (s) => (s || '').split('/')[0];
const normalizeTable = (s) => {
  if (!s) return 'Leads';
  const parts = String(s).split('/');
  return parts[parts.length - 1]; // název tabulky nebo tbl… ID
};

function toAirtableDate(input) {
  if (!input) return undefined; // nic neposílat
  const v = String(input).trim();
  if (!v) return undefined;
  // 1) už je to YYYY-MM-DD → vrať beze změny
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  // 2) český formát DD.MM.YYYY → převést
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(v)) {
    const [dd, mm, yyyy] = v.split('.');
    return `${yyyy}-${mm}-${dd}`;
  }
  // 3) cokoliv co projde new Date → převést na YYYY-MM-DD
  const d = new Date(v);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  return undefined;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
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

    // Honeypot (anti-spam)
    if (body['bot-field']) return res.status(200).json({ ok: true, skipped: true });

    // Vytváříme payload jen z ne-prázdných hodnot
    const fields = {};
    const add = (k, val) => {
      if (val === undefined || val === null) return;
      if (typeof val === 'string' && val.trim() === '') return;
      fields[k] = val;
    };

    add('Name', body.name);
    add('Email', body.email);

    const dateForAT = toAirtableDate(body.date);
    if (dateForAT) add('Date', dateForAT); // pokud není, neposíláme vůbec

    add('Venue', body.venue);
    add('Type', body.type);

    const attendees = body.attendees ? Number(body.attendees) : undefined;
    if (attendees !== undefined && !Number.isNaN(attendees)) add('Attendees', attendees);

    add('Start', body.start_time);
    add('End', body.end_time);
    add('Source', body.source);
    add('Note', body.note);
    add('UA', body.ua);
    add('Referer', body.referer);
    add('CreatedAt', new Date().toISOString());

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
