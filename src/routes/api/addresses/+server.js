/**
 * פרוקסי ל-data.gov.il (dev, Vercel וכו'). בלי שרת — הלקוח קורא ישירות דרך govIlStreets.js.
 */
import { json } from '@sveltejs/kit';
import { GOV_IL_STREETS_RESOURCE_ID } from '$lib/addresses/constants.js';

const DATASTORE_SEARCH = 'https://data.gov.il/api/3/action/datastore_search';

const FIELD_SYMBOL = 'סמל_ישוב';
const FIELD_CITY = 'שם_ישוב';
const FIELD_STREET = 'שם_רחוב';

async function fetchDatastore(params) {
    const qs = new URLSearchParams(params);
    const res = await fetch(`${DATASTORE_SEARCH}?${qs.toString()}`, {
        headers: { 'User-Agent': 'feel-app/1.0 (address-autocomplete)' }
    });
    const data = await res.json();
    if (!data.success) {
        const err = data.error || data;
        throw new Error(typeof err === 'object' ? JSON.stringify(err) : String(err));
    }
    return data.result;
}

/** GET ?type=city&q=... | ?type=street&symbol=...&q=... */
export async function GET({ url }) {
    const type = url.searchParams.get('type');
    const q = (url.searchParams.get('q') || '').trim();

    try {
        if (type === 'city') {
            if (q.length < 2) {
                return json({ success: true, cities: [] });
            }
            const result = await fetchDatastore({
                resource_id: GOV_IL_STREETS_RESOURCE_ID,
                limit: '100',
                q
            });
            const records = result.records || [];
            const seen = new Set();
            const cities = [];
            for (const r of records) {
                const sym = r[FIELD_SYMBOL];
                const name = String(r[FIELD_CITY] || '').trim();
                if (sym == null || !name) continue;
                const key = String(sym);
                if (seen.has(key)) continue;
                seen.add(key);
                cities.push({ symbol: Number(sym), name });
                if (cities.length >= 30) break;
            }
            return json({ success: true, cities });
        }

        if (type === 'street') {
            const symbolRaw = url.searchParams.get('symbol');
            const symbol = symbolRaw != null && symbolRaw !== '' ? Number(symbolRaw) : NaN;
            if (!Number.isFinite(symbol) || q.length < 1) {
                return json({ success: true, streets: [] });
            }
            const filters = JSON.stringify({ [FIELD_SYMBOL]: symbol });
            const result = await fetchDatastore({
                resource_id: GOV_IL_STREETS_RESOURCE_ID,
                limit: '40',
                q,
                filters
            });
            const records = result.records || [];
            const seen = new Set();
            const streets = [];
            for (const r of records) {
                const name = String(r[FIELD_STREET] || '').trim();
                if (!name) continue;
                if (seen.has(name)) continue;
                seen.add(name);
                streets.push({ name });
                if (streets.length >= 25) break;
            }
            return json({ success: true, streets });
        }

        return json({ success: false, error: 'invalid_type' }, { status: 400 });
    } catch (e) {
        console.error('addresses API:', e);
        return json({ success: false, error: 'upstream_failed' }, { status: 502 });
    }
}
