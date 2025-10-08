// /api/lead.js — Vercel Serverless Function

const AIRTABLE_URL = (base, table) =>
  `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}`;

// Normalize helpers – když bys omylem dal do ENV "app.../shr..." nebo "app.../tbl..."
const normalizeBaseId = (s) => (s || '').split('/')[0];
const normalizeTable = (s) => {
  if (!s) return 'Leads';
  const parts = String(s).split('/');
  return parts[parts.length - 1];
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

    // Honeypot – když to vyplní robot, request ignorujeme
    if (body['bot-field']) return res.status(200).json({ ok: true, skipped: true });

    // Mapování polí z formuláře → sloupce v Airtable
    const fields = {
      Name: body.name || '',
      Email: body.email || '',
      Date: body.date || '',
      Venue: body.venue || '',
      Type: body.type || '',
      Attendees: body.attendees ? Number(body.attendees) : undefined,
      Start: body.start_time || '',
      End: body.end_time || '',
      Source: body.source || '',
      Note: body.note || '',
      UA: body.ua || '',
      Referer: body.referer || '',
      CreatedAt: new Date().toISOString(),
    };
    Object.keys(fields).forEach((k) => fields[k] === undefined && delete fields[k]);

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
  } catch {
    return res.status(500).json({ ok:false, error:'SERVER_ERROR' });
  }
};
