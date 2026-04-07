const LS_PREFIX = 'feel_onboarding_';

export function getOnboardingKey(key) {
  return `${LS_PREFIX}${key}`;
}

export function isDismissed(key) {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(getOnboardingKey(key)) === 'dismissed';
  } catch {
    return false;
  }
}

export function dismiss(key) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getOnboardingKey(key), 'dismissed');
  } catch {}
}

export function resetDismissed(key) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(getOnboardingKey(key));
  } catch {}
}

