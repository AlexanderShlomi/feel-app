import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// מפורש כדי שבנייה מקומית תעבוד גם על Node 24+; ב-Vercel ירוץ nodejs22.x
		adapter: adapter({ runtime: 'nodejs22.x' })
	},
	preprocess: vitePreprocess()
};

export default config;
