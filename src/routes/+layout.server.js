/** כתובת אתר מוחלטת ל־og:image ו־og:url (שיתוף בוואטסאפ / פייסבוק). אופציונלי: PUBLIC_SITE_URL בפרודקשן. */
export function load({ url }) {
	const fromEnv =
		typeof process !== 'undefined' && process.env.PUBLIC_SITE_URL
			? String(process.env.PUBLIC_SITE_URL).replace(/\/$/, '')
			: '';
	const siteUrl = fromEnv || `${url.protocol}//${url.host}`;
	return { siteUrl };
}
