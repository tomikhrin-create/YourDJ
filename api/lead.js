// /api/lead.js (Vercel Serverless Function – funguje i u “statické” stránky)
const AIRTABLE_URL = (base, table) =>
  `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}`;

module.exports = async (req, res) => {
  // CORS (když budeš odesílat ze stejné domény, je to v pohodě; tohle je jen pojistka)
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);

    // Basic anti-spam (honeypot jsme ve formuláři posílali prázdný; kdyby byl vyplněný, drop)
    if (body['bot-field']) return res.status(200).json({ ok: true, skipped: true });

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

    // odstraníme undefined:
    Object.keys(fields).forEach((k) => fields[k] === undefined && delete fields[k]);

    const r = await fetch(
      AIRTABLE_URL(process.env.AIRTABLE_BASE_ID, process.env.AIRTABLE_TABLE_NAME || 'Leads'),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ records: [{ fields }] }),
      }
    );

    const data = await r.json();
    if (!r.ok) {
      console.error('Airtable error', data);
      return res.status(500).json({ ok: false, error: 'AIRTABLE_ERROR', details: data });
    }
    return res.status(200).json({ ok: true, id: data.records?.[0]?.id || null });
  } catch (e) {
    console.error('Lead API error', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
};
