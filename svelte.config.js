import adapter from '@sveltejs/adapter-static'; // שים לב: static במקום netlify
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			// הגדרות אלו קריטיות לגרירה ידנית ל-Netlify
			pages: 'build',
			assets: 'build',
			fallback: 'index.html', // זה הטריק שמונע שגיאות 404 ברענון עמוד
			precompress: false,
			strict: true
		})
	},
    preprocess: vitePreprocess()
};

export default config;