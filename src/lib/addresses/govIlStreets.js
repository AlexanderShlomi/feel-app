import { GOV_IL_STREETS_RESOURCE_ID } from '$lib/addresses/constants.js';

export { GOV_IL_STREETS_RESOURCE_ID };

/** קריאה ישירה ל-data.gov.il — גיבוי כשאין פרוקסי /api (למשל סטטי בלבד) */
const DATASTORE_SEARCH = 'https://data.gov.il/api/3/action/datastore_search';

const FIELD_SYMBOL = 'סמל_ישוב';
const FIELD_CITY = 'שם_ישוב';
const FIELD_STREET = 'שם_רחוב';

/**
 * @param {Record<string, string>} params
 */
async function callDatastore(params) {
    const qs = new URLSearchParams(params);
    const res = await fetch(`${DATASTORE_SEARCH}?${qs.toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/json' }
    });
    if (!res.ok) {
        throw new Error(`data.gov.il HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data.success) {
        const err = data.error || data;
        throw new Error(typeof err === 'object' ? JSON.stringify(err) : String(err));
    }
    return data.result;
}

/**
 * הצעות ישובים (מזהים ייחודיים) מתוך data.gov.il
 * @param {string} query
 * @returns {Promise<Array<{ symbol: number, name: string }>>}
 */
export async function fetchCitySuggestions(query) {
    const q = query.trim();
    if (q.length < 2) return [];

    const result = await callDatastore({
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
    return cities;
}

/**
 * הצעות רחובות לישוב נבחר (סמל משרד הפנים)
 * @param {number} settlementSymbol
 * @param {string} query
 * @returns {Promise<Array<{ name: string }>>}
 */
export async function fetchStreetSuggestions(settlementSymbol, query) {
    const q = query.trim();
    if (!Number.isFinite(settlementSymbol) || q.length < 1) return [];

    const filters = JSON.stringify({ [FIELD_SYMBOL]: settlementSymbol });
    const result = await callDatastore({
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
    return streets;
}
