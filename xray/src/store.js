// Lead capture / CRM (blueprint §14: "Supabase initially; connect to external
// CRM later"). If Supabase is configured we POST via its REST API; otherwise we
// append to a local JSONL file so nothing is ever lost in local/dev use.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

// X-Ray lead (from the audit email gate).
export async function saveLead(lead) {
  const record = {
    name: lead.name || null,
    email: lead.email || null,
    company: lead.company || null,
    industry: lead.industry || null,
    website: lead.website || null,
    score: lead.score ?? null,
    level: lead.level || null,
    source: 'xray',
    created_at: new Date().toISOString(),
  };
  return persist(record, config.supabase.table, 'leads.jsonl');
}

// Strategic-call request (from the "Parler à RIXZA" contact form, blueprint §11).
export async function saveContact(c) {
  const record = {
    name: c.name || null,
    company: c.company || null,
    email: c.email || null,
    phone: c.phone || null,
    website: c.website || null,
    need: c.need || null,
    message: c.message || null,
    timeline: c.timeline || null,
    source: 'contact',
    created_at: new Date().toISOString(),
  };
  return persist(record, config.supabase.contactsTable, 'contacts.jsonl');
}

// Insert into Supabase if configured, else append to ./data/<file>.
async function persist(record, table, file) {
  if (config.supabase.enabled) {
    const res = await fetch(`${config.supabase.url}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: config.supabase.key,
        authorization: `Bearer ${config.supabase.key}`,
        prefer: 'return=minimal',
      },
      body: JSON.stringify(record),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Supabase ${res.status}: ${body.slice(0, 200)}`);
    }
    return { stored: 'supabase' };
  }

  const dir = join(config.root, 'data');
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, file), JSON.stringify(record) + '\n', 'utf8');
  return { stored: 'file' };
}
