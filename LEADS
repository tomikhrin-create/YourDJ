// /api/lead.js — Vercel Serverless Function
// Works for static sites too (just place this file in a top-level "api" folder)

const AIRTABLE_URL = (base, table) =>
  `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}`;

module.exports = async (req, res) => {
  // Basic CORS (safe for same-origin form posts as well)
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

    // Honeypot — if robots fill this, we silently accept and skip
    if (body['bot-field']) return res.status(200).json({ ok: true, skipped: true });

    // Map incoming form fields → Airtable columns
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

    // Remove undefined so Airtable doesn't reject the payload
    Object.keys(fields).forEach((k) => fields[k] === undefined && delete fields[k]);

    const baseId = process.env.AIRTABLE_BASE_ID;
    const table = process.env.AIRTABLE_TABLE_NAME || 'Leads';
    const key = process.env.AIRTABLE_API_KEY;

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
      // Surface Airtable error for easier debugging in Vercel Logs
      return res.status(500).json({ ok: false, error: 'AIRTABLE_ERROR', details: data });
    }

    const id = data.records?.[0]?.id || null;
    return res.status(200).json({ ok: true, id });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
};
