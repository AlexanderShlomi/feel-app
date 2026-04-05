/** @param {string} input */
export function normalizeIsraelMobileToE164(input) {
    const digits = String(input || '').replace(/\D/g, '');
    let local = '';

    if (digits.startsWith('972') && digits.length >= 11) {
        local = '0' + digits.slice(3, 12);
    } else if (digits.startsWith('0') && digits.length === 10) {
        local = digits;
    } else if (digits.length === 9 && digits.startsWith('5')) {
        local = '0' + digits;
    } else {
        return null;
    }

    if (!/^05[0-9]{8}$/.test(local)) return null;
    return '+972' + local.slice(1);
}
