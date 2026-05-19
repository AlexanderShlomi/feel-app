import { browser } from '$app/environment';
import { supabase } from '$lib/supabase';

/**
 * מטרה: להזניק את שאילתת ה-RPC של ההזמנות בזמן ניווט (preload בהובר → מהיר עוד יותר),
 * במקביל ל-hydration של הקומפוננטה ולפני ש-`onMount` רץ.
 *
 * חשוב:
 *  - אנחנו לא ממתינים ל-RPC כאן (load() לא חוסם את הרינדור) — אנחנו רק מחזירים Promise.
 *  - הקומפוננטה מקבלת את `data.ordersPromise` ויכולה לרנדר מיידית snapshot מ-cache,
 *    ואז להחליף לתוצאה הטרייה ברגע שה-promise נסגר.
 *  - ב-SSR לא משתמשים ב-supabase client (אין session). מחזירים null ונופלים לחזרה ה-onMount הרגיל.
 *
 * @type {import('./$types').PageLoad}
 */
export const load = async () => {
    if (!browser) {
        return { ordersPromise: null };
    }

    const rpcPromise = supabase.rpc('my_orders_dashboard', {
        p_max_orders: 26,
        p_offset: 0
    });

    const sessionPromise = supabase.auth.getSession();

    const ordersPromise = Promise.all([rpcPromise, sessionPromise])
        .then(([rpcRes, sessRes]) => ({
            data: rpcRes?.data ?? null,
            error: rpcRes?.error ?? null,
            userId: sessRes?.data?.session?.user?.id ?? null
        }))
        .catch((err) => ({
            data: null,
            error: /** @type {any} */ ({ message: err instanceof Error ? err.message : String(err) }),
            userId: null
        }));

    return { ordersPromise };
};
