import { z } from 'zod';
import { normalizeIsraelMobileToE164 } from './contact.js';

export const authEmailSchema = z
    .string()
    .trim()
    .min(1, 'יש להזין אימייל')
    .email('אימייל לא תקין');

export const authOtpSchema = z
    .string()
    .trim()
    .regex(/^\d{6,8}$/, 'קוד אימות חייב להיות 6–8 ספרות');

/**
 * @param {string} dmy DD/MM/YYYY
 * @returns {string | null} YYYY-MM-DD
 */
export function parseBirthdayDmyToIso(dmy) {
    const s = String(dmy || '').trim();
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    if (!m) return null;
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = Number(m[3]);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || yyyy < 1900 || yyyy > 2100) return null;
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    if (d.getUTCFullYear() !== yyyy || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) return null;
    const today = new Date();
    const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    if (d.getTime() > todayUtc) return null;
    return `${yyyy.toString().padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

export const authRegistrationSchema = z.object({
    fullName: z
        .string()
        .trim()
        .min(2, 'יש להזין שם מלא')
        .max(120, 'שם ארוך מדי')
        .refine((val) => /^[\u0590-\u05FFa-zA-Z\s]+$/u.test(val), 'שם מכיל תווים לא חוקיים'),
    birthdayDmy: z
        .string()
        .trim()
        .refine((val) => !!parseBirthdayDmyToIso(val), 'תאריך לידה לא תקין (DD/MM/YYYY)'),
    phone: z.string().refine((val) => !!normalizeIsraelMobileToE164(val), 'מספר נייד לא תקין')
});
