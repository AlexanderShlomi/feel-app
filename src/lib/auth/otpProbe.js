/**
 * אחרי signInWithOtp({ shouldCreateUser: false }) — האם השגיאה אומרת "אין משתמש, הציעו רישום"?
 * GoTrue מחזיר לעיתים user_not_found או הודעות דומות; לא תמיד מבדיל ממקרים אחרים.
 */
export function shouldOfferRegistrationAfterOtpDeny(error) {
    if (!error) return false;
    const code = String(error.code || '').toLowerCase();
    if (code === 'user_not_found') return true;
    if (code === 'signup_disabled') return true;

    const msg = String(error.message || '').toLowerCase();
    if (msg.includes('user not found')) return true;
    if (msg.includes('no user found')) return true;
    if (msg.includes('email not found')) return true;
    if (msg.includes('sign up') && msg.includes('not')) return true;
    if (msg.includes('signup') && msg.includes('disabled')) return true;

    const status = error.status;
    if (status === 404 || status === 422) return true;

    return false;
}
