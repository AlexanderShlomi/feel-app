import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// מפורש כדי שבנייה מקומית תעבוד גם על Node 24+; ב-Vercel ירוץ nodejs22.x
		adapter: adapter({ runtime: 'nodejs22.x' }),

		csrf: {
			/* טרנזילה מחזירה את הלקוח מדף הסליקה שלה אל /checkout/return בבקשת
			   POST. זו בקשה חוצת-מקורות, ולכן הגנת ה-CSRF המובנית של SvelteKit
			   חסמה אותה עם "Cross-site POST form submissions are forbidden" —
			   הנתיב שלנו לא רץ בכלל.

			   מוסיפים רק את המקורות של דף הסליקה, ולא מכבים את ההגנה גלובלית:
			   כל שאר ה-form actions באפליקציה נשארים מוגנים.

			   זה בטוח גם אם טרנזילה תשלח משהו זדוני: הנתיב הזה לא קורא את גוף
			   הבקשה, לא כותב לשום מקום, ולא מסיק ממנו דבר. מעבר ההזמנה ל-paid
			   נעשה אך ורק ב-tranzila-notify, שמאמת את העסקה מול טרנזילה (Law D). */
			trustedOrigins: ['https://directng.tranzila.com', 'https://direct.tranzila.com']
		}
	},
	preprocess: vitePreprocess()
};

export default config;
