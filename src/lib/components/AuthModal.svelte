<script>
    import { fade, fly } from 'svelte/transition';
    import { onDestroy } from 'svelte';
    import { supabase, loginWithGoogle, loginWithFacebook } from '$lib/supabase';
    import { refreshProfile } from '$lib/authStore';
    import { shouldOfferRegistrationAfterOtpDeny } from '$lib/auth/otpProbe.js';
    import { normalizeIsraelMobileToE164 } from '$lib/validation/contact.js';
    import {
        authEmailSchema,
        authRegistrationSchema,
        validateBirthdayIso,
        authOtpSchema
    } from '$lib/validation/authSchema.js';
    import { maskIsraelMobileInput } from '$lib/validation/inputMasks.js';

    export let isOpen = false;
    export let close = () => {};

    /** 'email' | 'otp' */
    let authStep = 'email';
    /** לפני בדיקה: 'idle' | אחרי בדיקה ב-DB: 'existing' | 'new' */
    let lookupState = 'idle';

    let email = '';
    let phone = '';
    let otpToken = '';
    /** YYYY-MM-DD מ־`<input type="date">` */
    let birthdayIso = '';
    let fullName = '';
    let loading = false;
    let message = { text: '', type: '' };

    let emailError = '';
    let phoneError = '';
    let nameError = '';
    let birthdayError = '';

    /** שליחת קוד חוזרת (OTP) */
    let resendCooldown = 0;
    let resendIntervalId = null;

    function normalizeEmail(value) {
        return String(value || '').trim().toLowerCase();
    }

    function clearResendTimer() {
        if (resendIntervalId) {
            clearInterval(resendIntervalId);
            resendIntervalId = null;
        }
        resendCooldown = 0;
    }

    function startResendCooldown(seconds = 60) {
        clearResendTimer();
        resendCooldown = seconds;
        resendIntervalId = setInterval(() => {
            resendCooldown--;
            if (resendCooldown <= 0) {
                clearResendTimer();
            }
        }, 1000);
    }

    onDestroy(() => {
        clearResendTimer();
    });

    function resetFieldErrors() {
        emailError = '';
        phoneError = '';
        nameError = '';
        birthdayError = '';
    }

    function applyZodFieldErrors(flat) {
        nameError = flat.fullName?.[0] ?? '';
        birthdayError = flat.birthdayIso?.[0] ?? '';
        phoneError = flat.phone?.[0] ?? '';
    }

    /**
     * שלב 1א: בדיקה מול Supabase Auth בלבד — לא RPC.
     * signInWithOtp(shouldCreateUser: false): הצלחה = משתמש קיים → קוד נשלח ומעבר ל-OTP.
     * שגיאה שמזוהה כ"אין משתמש" → מסך השלמת רישום.
     */
    async function handleContinueEmail() {
        resetFieldErrors();
        message = { text: '', type: '' };

        const emailParsed = authEmailSchema.safeParse(email);
        if (!emailParsed.success) {
            emailError = emailParsed.error.issues[0]?.message ?? 'אימייל לא תקין';
            return;
        }

        const emailNorm = normalizeEmail(emailParsed.data);

        loading = true;
        const { error } = await supabase.auth.signInWithOtp({
            email: emailNorm,
            options: {
                shouldCreateUser: false,
                emailRedirectTo: window.location.origin
            }
        });
        loading = false;

        if (!error) {
            lookupState = 'existing';
            authStep = 'otp';
            startResendCooldown();
            message = { text: 'קוד אימות נשלח לתיבת המייל שלך', type: 'success' };
            return;
        }

        if (shouldOfferRegistrationAfterOtpDeny(error)) {
            lookupState = 'new';
            message = {
                text: 'נרשמים בפעם הראשונה. מלאו שם, תאריך לידה וטלפון, ואז שלחו קוד אימות.',
                type: 'success'
            };
            return;
        }

        console.warn('Auth signInWithOtp (existing user probe):', error);
        message = {
            text: error.message || 'לא ניתן להמשיך כרגע. נסו שוב או בדקו את חיבור האינטרנט.',
            type: 'error'
        };
    }

    async function sendOtpExistingUser(emailNorm) {
        loading = true;
        const { error } = await supabase.auth.signInWithOtp({
            email: emailNorm,
            options: {
                shouldCreateUser: false,
                emailRedirectTo: window.location.origin
            }
        });
        loading = false;

        if (error) {
            message = {
                text: error.message || 'שגיאה בשליחת הקוד. נסו שוב או פנו לתמיכה.',
                type: 'error'
            };
            return;
        }

        authStep = 'otp';
        startResendCooldown();
        message = { text: 'קוד אימות נשלח לתיבת המייל שלך', type: 'success' };
    }

    /** שליחת OTP: משתמש קיים — shouldCreateUser: false; חדש — true אחרי ולידציית שדות (Zod) */
    async function handleSendOTP() {
        resetFieldErrors();
        message = { text: '', type: '' };

        const emailParsed = authEmailSchema.safeParse(email);
        if (!emailParsed.success) {
            emailError = emailParsed.error.issues[0]?.message ?? 'אימייל לא תקין';
            return;
        }
        const emailNorm = normalizeEmail(emailParsed.data);

        if (lookupState === 'idle') {
            return;
        }

        if (lookupState === 'existing') {
            await sendOtpExistingUser(emailNorm);
            return;
        }

        const reg = authRegistrationSchema.safeParse({
            fullName,
            birthdayIso,
            phone
        });
        if (!reg.success) {
            applyZodFieldErrors(reg.error.flatten().fieldErrors);
            return;
        }

        loading = true;
        const { error } = await supabase.auth.signInWithOtp({
            email: emailNorm,
            options: {
                shouldCreateUser: true,
                emailRedirectTo: window.location.origin
            }
        });
        loading = false;

        if (error) {
            if (
                error.message?.toLowerCase().includes('already registered') ||
                error.message?.toLowerCase().includes('already been registered')
            ) {
                message = {
                    text: 'המייל כבר רשום במערכת האימות. נסו "המשך" שוב או התחברות.',
                    type: 'error'
                };
            } else {
                message = { text: error.message || 'שגיאה בשליחת הקוד. נסה שוב.', type: 'error' };
            }
            return;
        }

        authStep = 'otp';
        startResendCooldown();
        message = { text: 'קוד אימות נשלח לתיבת המייל שלך', type: 'success' };
    }

    async function handleResendOtp() {
        if (resendCooldown > 0 || loading) return;
        const emailParsed = authEmailSchema.safeParse(email);
        if (!emailParsed.success) return;

        const emailNorm = normalizeEmail(emailParsed.data);
        loading = true;
        message = { text: '', type: '' };

        const opts = {
            emailRedirectTo: window.location.origin
        };
        const { error } = await supabase.auth.signInWithOtp({
            email: emailNorm,
            options:
                lookupState === 'new'
                    ? { ...opts, shouldCreateUser: true }
                    : { ...opts, shouldCreateUser: false }
        });
        loading = false;

        if (error) {
            message = { text: error.message || 'שגיאה בשליחה חוזרת', type: 'error' };
            return;
        }
        message = { text: 'נשלח קוד חדש למייל', type: 'success' };
        startResendCooldown();
    }

    // אימות OTP + יצירת פרופיל (חדש) / כניסה (קיים)
    async function handleVerifyOTP() {
        loading = true;
        resetFieldErrors();

        const otpCheck = authOtpSchema.safeParse(otpToken);
        if (!otpCheck.success) {
            message = { text: otpCheck.error.issues[0]?.message ?? 'קוד לא תקין', type: 'error' };
            loading = false;
            return;
        }

        const { data, error } = await supabase.auth.verifyOtp({
            email: normalizeEmail(email),
            token: otpCheck.data.trim(),
            type: 'email'
        });

        if (error) {
            message = { text: 'קוד שגוי או פג תוקף', type: 'error' };
            loading = false;
            return;
        }

        if (data.user) {
            if (lookupState === 'new') {
                const phoneE164 = normalizeIsraelMobileToE164(phone);
                const birthdayStored = validateBirthdayIso(birthdayIso);
                if (!phoneE164 || !birthdayStored) {
                    message = { text: 'פרטי הרישום אינם תקינים. חזרו אחורה ועדכנו.', type: 'error' };
                    loading = false;
                    return;
                }
                const { error: profileError } = await supabase.from('profiles').upsert({
                    id: data.user.id,
                    full_name: fullName.trim() || null,
                    birthday: birthdayStored,
                    phone: phoneE164,
                    updated_at: new Date().toISOString()
                });

                if (profileError) {
                    console.error('profiles upsert:', profileError);
                    message = { text: 'התחברת, אך עדכון הפרופיל נכשל. נסה שוב מההגדרות.', type: 'error' };
                    loading = false;
                    return;
                }
                await refreshProfile(data.user.id);
                message = { text: 'התחברת בהצלחה!', type: 'success' };
                loading = false;
                setTimeout(() => finishAndClose(), 1500);
            } else {
                const { data: existing } = await supabase
                    .from('profiles')
                    .select('id')
                    .eq('id', data.user.id)
                    .maybeSingle();

                if (!existing) {
                    await supabase.from('profiles').insert({
                        id: data.user.id,
                        updated_at: new Date().toISOString()
                    });
                }

                await refreshProfile(data.user.id);
                message = { text: 'התחברת בהצלחה!', type: 'success' };
                loading = false;
                setTimeout(() => finishAndClose(), 1500);
            }
        } else {
            loading = false;
        }
    }

    function finishAndClose() {
        close();
        authStep = 'email';
        lookupState = 'idle';
        otpToken = '';
        phone = '';
        fullName = '';
        birthdayIso = '';
    }

    function goBackToEmail() {
        authStep = 'email';
        otpToken = '';
    }

    function onEmailInput() {
        lookupState = 'idle';
        emailError = '';
    }

    function onNameInput(e) {
        fullName = e.currentTarget.value.replace(/[^\u0590-\u05FFa-zA-Z\s]/gu, '');
        nameError = '';
    }

    function onBirthdayInput() {
        birthdayError = '';
    }

    /** מקסימום לבחירת תאריך — היום (מקומי) */
    $: maxBirthdayIso = (() => {
        const t = new Date();
        return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    })();

    /** גלילה למרכז ה-viewport כשהמקלדת פתוחה (משלים scroll-padding) */
    function onAuthFieldFocusIn(e) {
        const el = e.target;
        if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return;
        requestAnimationFrame(() => {
            el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
    }

    function onPhoneInputMasked(e) {
        phone = maskIsraelMobileInput(e.currentTarget.value);
        phoneError = '';
    }

    function handleEmailStepSubmit() {
        if (lookupState === 'idle') {
            handleContinueEmail();
        } else {
            handleSendOTP();
        }
    }

    // 3. התחברות באמצעות פדרציה (Social)
    async function handleGoogleLogin() {
        const { error } = await loginWithGoogle();
        if (error) {
            console.error('Google OAuth:', error);
            message = { text: `שגיאה בחיבור ל-Google: ${error.message || 'בדקו הגדרות ספק ו-Redirect URL'}`, type: 'error' };
        }
    }

    async function handleFacebookLogin() {
        const { error } = await loginWithFacebook();
        if (error) {
            console.error('Facebook OAuth:', error);
            message = { text: `שגיאה בחיבור ל-Facebook: ${error.message || 'בדקו הגדרות ספק ו-Redirect URL'}`, type: 'error' };
        }
    }

    function onOverlayKeyDown(e) {
        if (e.key === 'Escape') close();
    }

    function resetAuthModalState() {
        authStep = 'email';
        lookupState = 'idle';
        otpToken = '';
        email = '';
        phone = '';
        fullName = '';
        birthdayIso = '';
        message = { text: '', type: '' };
        loading = false;
        resetFieldErrors();
        clearResendTimer();
    }

    let previousIsOpen = false;
    /** איפוס רק בסגירת המודאל (מעבר מפתוח לסגור) — מונע שדות רישום "תקועים" בפתיחה הבאה */
    $: {
        if (previousIsOpen && !isOpen) {
            resetAuthModalState();
        }
        previousIsOpen = isOpen;
    }
</script>

{#if isOpen}
<div
    class="auth-overlay"
    transition:fade={{ duration: 250 }}
    role="button"
    tabindex="0"
    aria-label="סגור חלון התחברות"
    on:click|self={close}
    on:keydown={onOverlayKeyDown}
>
    <div class="auth-modal" transition:fly={{ y: 50, duration: 450 }}>
        
        <button class="close-btn" on:click={close} aria-label="סגור">&times;</button>

        <div class="auth-container" dir="rtl" on:focusin={onAuthFieldFocusIn}>
            <header class="auth-header">
                <div class="brand-line">FEEL • LUXURY MEMORIES</div>
                <h1>
                    {#if authStep === 'otp'}
                        אימות OTP
                    {:else if lookupState === 'new'}
                        השלמת רישום
                    {:else}
                        רגע של חיבור
                    {/if}
                </h1>
                <p class="tagline">לעצור את הזמן – להרגיש את הרגע</p>
            </header>

            {#if message.text}
                <div class="message {message.type}" transition:fade>{message.text}</div>
            {/if}

            {#if authStep === 'email'}
            <div class="social-actions">
                <button class="social-btn google" on:click={handleGoogleLogin} style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 16 16">
                        <path fill="#3E82F1" d="M8.08 6.605v3.043h4.257a3.6 3.6 0 0 1-1.577 2.372v1.974h2.554c1.497-1.369 2.359-3.383 2.359-5.777 0-.556-.049-1.095-.142-1.607H8.08z"></path>
                        <path fill="#32A753" d="M8.08 12.773c-2.06 0-3.802-1.383-4.424-3.242H1.013v2.04A7.92 7.92 0 0 0 8.08 15.9c2.137 0 3.927-.703 5.233-1.904l-2.554-1.974c-.707.473-1.613.75-2.68.75"></path>
                        <path fill="#F9BB00" d="M3.656 4.508H1.013a7.84 7.84 0 0 0 0 7.057L3.656 9.53a4.7 4.7 0 0 1-.249-1.492c0-.517.089-1.02.249-1.493z"></path>
                        <path fill="#E74133" d="m1.013 4.508 2.643 2.036c.622-1.86 2.363-3.241 4.425-3.241 1.16 0 2.203.397 3.02 1.174l2.27-2.257C12.005.953 10.214.176 8.082.176a7.91 7.91 0 0 0-7.068 4.332"></path>
                    </svg>
                    המשך עם Google
                </button>
            
                <button class="social-btn facebook" on:click={handleFacebookLogin} style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" fill="#1877F2"></circle>
                        <path fill="#fff" d="M13.22 19v-6h2.02l.3-2.34h-2.32v-1.5c0-.68.19-1.14 1.17-1.14h1.24V5.92c-.21-.03-.94-.09-1.78-.09-1.76 0-2.97 1.07-2.97 3.04v1.79H8.89V13h1.99v6h2.34z"></path>
                    </svg>
                    המשך עם Facebook
                </button>
            </div>

                <div class="separator"><span>או באמצעות מייל</span></div>

                <form class="auth-form" on:submit|preventDefault={handleEmailStepSubmit}>
                    <div class="input-group">
                        <div class="label-row">
                            <label for="email">כתובת אימייל</label>
                            <button
                                type="button"
                                class="auth-tooltip-trigger"
                                dir="rtl"
                                data-tooltip="לאחר הזנת המייל ולחיצה על «המשך» נבדוק אם כבר קיים חשבון. אם כן — יישלח לכאן קוד אימות חד-פעמי."
                                aria-label="הסבר על שדה האימייל"
                            >
                                <svg class="auth-tip-svg" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                            </button>
                        </div>
                        <input
                            type="email"
                            id="email"
                            bind:value={email}
                            on:input={onEmailInput}
                            placeholder="לדוגמה: shuki@example.com"
                            autocomplete="email"
                            class:input-invalid={emailError}
                            aria-invalid={emailError ? 'true' : 'false'}
                            aria-describedby={emailError ? 'email-error' : undefined}
                            required
                        />
                        {#if emailError}
                            <span id="email-error" class="field-error" role="alert">{emailError}</span>
                        {/if}
                    </div>

                    {#if lookupState === 'new'}
                        <div class="input-group">
                            <div class="label-row">
                                <label for="reg-name">שם מלא</label>
                                <button
                                    type="button"
                                    class="auth-tooltip-trigger"
                                    dir="rtl"
                                    data-tooltip="אותיות בעברית או באנגלית בלבד (כולל רווחים בין שמות). ללא מספרים או תווים מיוחדים."
                                    aria-label="הסבר על שדה השם"
                                >
                                    <svg class="auth-tip-svg" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                                </button>
                            </div>
                            <input
                                type="text"
                                id="reg-name"
                                value={fullName}
                                on:input={onNameInput}
                                placeholder="למשל: יעל כהן"
                                autocomplete="name"
                                enterkeyhint="next"
                                class:input-invalid={nameError}
                                aria-invalid={nameError ? 'true' : 'false'}
                                required
                            />
                            {#if nameError}
                                <span class="field-error" role="alert">{nameError}</span>
                            {/if}
                        </div>
                        <div class="input-group">
                            <div class="label-row">
                                <label for="reg-birthday">תאריך לידה</label>
                                <button
                                    type="button"
                                    class="auth-tooltip-trigger"
                                    dir="rtl"
                                    data-tooltip="בוחרים תאריך בלוח השנה של המכשיר. לא ניתן לבחור תאריך עתידי. נשמח לחגוג איתך ולהציע הטבות בהמשך."
                                    aria-label="הסבר על תאריך הלידה"
                                >
                                    <svg class="auth-tip-svg" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                                </button>
                            </div>
                            <input
                                type="date"
                                id="reg-birthday"
                                dir="ltr"
                                min="1900-01-01"
                                max={maxBirthdayIso}
                                bind:value={birthdayIso}
                                on:input={onBirthdayInput}
                                autocomplete="bday"
                                class="input-date-native"
                                class:input-invalid={birthdayError}
                                aria-invalid={birthdayError ? 'true' : 'false'}
                                required
                            />
                            {#if birthdayError}
                                <span class="field-error" role="alert">{birthdayError}</span>
                            {/if}
                        </div>
                        <div class="input-group">
                            <div class="label-row">
                                <label for="phone">טלפון נייד</label>
                                <button
                                    type="button"
                                    class="auth-tooltip-trigger"
                                    dir="rtl"
                                    data-tooltip="מספר נייד ישראלי: מתחיל ב-05 ואחריו 8 ספרות. קוד האימות נשלח למייל בלבד, לא בהודעת SMS."
                                    aria-label="הסבר על מספר הטלפון"
                                >
                                    <svg class="auth-tip-svg" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                                </button>
                            </div>
                            <input
                                type="tel"
                                id="phone"
                                value={phone}
                                on:input={onPhoneInputMasked}
                                placeholder="05X-XXX-XXXX"
                                maxlength="12"
                                autocomplete="tel"
                                inputmode="numeric"
                                class:input-invalid={phoneError}
                                aria-invalid={phoneError ? 'true' : 'false'}
                                aria-describedby={phoneError ? 'phone-error' : undefined}
                                required
                            />
                            {#if phoneError}
                                <span id="phone-error" class="field-error" role="alert">{phoneError}</span>
                            {/if}
                        </div>
                    {/if}

                    {#if lookupState === 'existing'}
                        <p class="auth-info-box" role="status">נשלח קוד חד-פעמי לאימות — בדקו את תיבת הדואר (גם בספאם).</p>
                    {/if}

                    <button type="submit" class="submit-btn" disabled={loading}>
                        {#if loading}
                            {lookupState === 'idle' ? 'בודקים...' : 'שולח קוד...'}
                        {:else if lookupState === 'idle'}
                            המשך
                        {:else}
                            שלחו לי קוד אימות
                        {/if}
                    </button>
                </form>

            {:else if authStep === 'otp'}
                <form class="auth-form" on:submit|preventDefault={handleVerifyOTP}>
                    <p class="auth-info-box otp-mail-line" role="status">
                        הקוד נשלח לכתובת <span class="otp-mail" dir="ltr">{email}</span>
                    </p>
                    <div class="input-group">
                        <div class="label-row">
                            <label for="otp">קוד אימות</label>
                            <button
                                type="button"
                                class="auth-tooltip-trigger"
                                dir="rtl"
                                data-tooltip="הזינו את הקוד שקיבלתם במייל (בדרך כלל 6 עד 8 ספרות). אם אין מייל — חכו דקה ובדקו גם בתיקיית ספאם או קידומי דואר."
                                aria-label="הסבר על קוד האימות"
                            >
                                <svg class="auth-tip-svg" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                            </button>
                        </div>
                        <input
                            type="text"
                            id="otp"
                            bind:value={otpToken}
                            placeholder="6–8 ספרות מהמייל"
                            maxlength="8"
                            inputmode="numeric"
                            autocomplete="one-time-code"
                            required
                        />
                    </div>

                    <button type="submit" class="submit-btn gold" disabled={loading}>
                        {loading ? 'מאמת...' : 'כניסה לעולם של FEEL'}
                    </button>
                    <div class="otp-resend">
                        <button
                            type="button"
                            class="text-btn resend-btn"
                            disabled={loading || resendCooldown > 0}
                            on:click={handleResendOtp}
                        >
                            {#if resendCooldown > 0}
                                שליחה חוזרת בעוד {resendCooldown} שנ׳
                            {:else}
                                שלחו קוד מחדש
                            {/if}
                        </button>
                    </div>
                    <button type="button" class="text-btn" on:click={goBackToEmail}>חזרה להזנת מייל</button>
                </form>
            {/if}
        </div>
    </div>
</div>
{/if}

<style>
    .auth-overlay {
        position: fixed;
        inset: 0;
        width: 100%;
        max-width: 100%;
        min-height: 100dvh;
        min-height: 100dvh;
        box-sizing: border-box;
        background: rgba(30, 30, 30, 0.8);
        backdrop-filter: blur(15px);
        z-index: 9500;
        display: flex;
        justify-content: center;
        align-items: center;
        padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
            max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
        overflow-x: hidden;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior: contain;
        scroll-padding-top: max(20px, env(safe-area-inset-top));
        scroll-padding-bottom: max(100px, env(safe-area-inset-bottom), var(--vv-bottom-chrome, 0px));
    }

    @media (max-width: 768px) {
        .auth-overlay {
            align-items: flex-start;
        }
    }

    .auth-modal {
        background: #F2F0EC;
        color: #1E1E1E;
        width: 100%;
        max-width: 440px;
        border-radius: 30px;
        position: relative;
        overflow: visible;
        box-shadow: 0 40px 100px rgba(0, 0, 0, 0.3);
        box-sizing: border-box;
        flex: 0 0 auto;
    }

    .close-btn {
        position: absolute; top: 20px; left: 20px; background: none; border: none;
        color: #846349; font-size: 35px; cursor: pointer; line-height: 1; z-index: 10;
    }

    .auth-container {
        padding: 50px 40px max(48px, env(safe-area-inset-bottom), var(--vv-bottom-chrome, 0px), 72px);
        overflow: visible;
        box-sizing: border-box;
        max-width: 100%;
    }

    .auth-header { text-align: center; margin-bottom: 35px; }
    .brand-line { color: #846349; font-weight: 800; font-size: 10px; letter-spacing: 3px; margin-bottom: 8px; }
    h1 { font-size: 28px; margin: 0; font-weight: 700; color: #1E1E1E; }
    .tagline { font-size: 14px; color: #846349; margin-top: 5px; font-style: italic; }

    .message { padding: 12px; border-radius: 10px; margin-bottom: 20px; text-align: center; font-size: 14px; font-weight: 600; }
    .message.error { background: #fee2e2; color: #b91c1c; }
    .message.success { background: #dcfce7; color: #15803d; }

    .social-actions { display: flex; flex-direction: column; gap: 12px; margin-bottom: 25px; }
    .social-btn {
        display: flex; align-items: center; justify-content: center; gap: 12px;
        padding: 14px; border-radius: 12px; border: 1px solid #DDD; background: white;
        font-weight: 700; font-size: 15px; cursor: pointer; transition: 0.2s;
    }
    .social-btn:hover { background: #f9f9f9; transform: translateY(-1px); box-shadow: 0 4px 10px rgba(0,0,0,0.05); }

    .separator {
        text-align: center; position: relative; margin-bottom: 25px;
    }
    .separator::before { content: ""; position: absolute; top: 50%; left: 0; width: 100%; height: 1px; background: #EEE; }
    .separator span { position: relative; background: #F2F0EC; padding: 0 15px; color: #999; font-size: 13px; }

    .auth-form { display: flex; flex-direction: column; gap: 20px; }
    .input-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
        scroll-margin-block: 24px;
        box-sizing: border-box;
        max-width: 100%;
    }

    .label-row {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 8px;
        padding-right: 5px;
    }
    .label-row label {
        font-size: 13px;
        font-weight: 700;
        color: #846349;
        margin: 0;
    }

    /* הסבר מעל (כמו ב-app.css) — טקסט עברי רב-שורות, RTL */
    .auth-modal .auth-tooltip-trigger {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: #846349;
        cursor: help;
        flex-shrink: 0;
        line-height: 0;
        margin: 0;
        padding: 2px;
        border: none;
        background: transparent;
        font: inherit;
    }
    .auth-modal .auth-tooltip-trigger:hover,
    .auth-modal .auth-tooltip-trigger:focus-visible {
        color: var(--color-dark-blue, #1e1e1e);
        outline: none;
    }
    .auth-modal .auth-tooltip-trigger::before {
        white-space: normal;
        max-width: min(280px, 86vw);
        width: max-content;
        text-align: right;
        line-height: 1.45;
        font-weight: 600;
        padding: 8px 12px;
        border-radius: 8px;
        background-color: var(--color-dark-blue, #1e1e1e);
        color: var(--color-gold, #c6b29a);
        border: 1px solid var(--color-gold, #c6b29a);
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.25);
    }
    .auth-modal .auth-tooltip-trigger:focus-visible::before,
    .auth-modal .auth-tooltip-trigger:focus-visible::after {
        opacity: 1;
        visibility: visible;
    }
    .auth-modal .auth-tooltip-trigger:focus-visible::before {
        transform: translateX(-50%) translateY(-10px);
    }
    .auth-modal .auth-tooltip-trigger:focus-visible::after {
        transform: translateX(-50%) translateY(-4px);
    }
    .auth-tip-svg {
        display: block;
        pointer-events: none;
    }

    /* תיבת מידע קבועה — אותה פלטה כמו tooltip גלובלי */
    .auth-info-box {
        margin: 0;
        padding: 10px 14px;
        border-radius: 10px;
        font-size: 13px;
        font-weight: 600;
        line-height: 1.5;
        text-align: right;
        background-color: var(--color-dark-blue, #1e1e1e);
        color: var(--color-gold, #c6b29a);
        border: 1px solid var(--color-gold, #c6b29a);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    }
    .otp-mail-line .otp-mail {
        font-weight: 800;
        color: #f2f0ec;
        word-break: break-all;
    }
    .input-group input {
        padding: 15px;
        border-radius: 12px;
        border: 1px solid #ddd;
        font-family: 'Assistant', sans-serif;
        font-size: 16px;
        transition: border-color 0.2s;
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
        min-height: 48px;
    }

    /* Native date picker — מינימום 16px נגד zoom אוטומטי ב-iOS */
    .input-group input.input-date-native {
        min-height: 48px;
        -webkit-appearance: none;
        appearance: none;
    }
    .input-group input.input-date-native::-webkit-calendar-picker-indicator {
        opacity: 0.85;
        cursor: pointer;
        padding-inline-start: 4px;
    }
    .input-group input:focus { border-color: #C6B29A; outline: none; }
    .input-group input.input-invalid {
        border-color: #b91c1c;
        background: #fffafa;
    }
    .input-group input.input-invalid:focus {
        border-color: #b91c1c;
        box-shadow: 0 0 0 2px rgba(185, 28, 28, 0.12);
    }
    .field-error {
        font-size: 12px;
        font-weight: 600;
        color: #b91c1c;
        margin-top: 2px;
        padding-right: 5px;
    }
    .otp-resend {
        text-align: center;
        margin: 4px 0 0 0;
    }
    .resend-btn:disabled {
        opacity: 0.55;
        cursor: not-allowed;
        text-decoration: none;
    }

    .submit-btn {
        background: #1E1E1E; color: white; border: none; padding: 18px;
        border-radius: 50px; font-weight: 800; font-size: 16px; cursor: pointer;
        transition: 0.3s;
    }
    .submit-btn.gold { background: #C6B29A; }
    .submit-btn:hover:not(:disabled) { opacity: 0.9; transform: scale(1.02); }
    .submit-btn:disabled { background: #CCC; cursor: not-allowed; }

    .text-btn { background: none; border: none; color: #846349; cursor: pointer; font-weight: 600; text-decoration: underline; margin-top: 10px; }

    @media (max-width: 768px) {
        .auth-modal {
            width: 100%;
            max-width: 100%;
            min-height: 100dvh;
            min-height: 100dvh;
            border-radius: 0;
        }
        .auth-container {
            padding: 80px 20px max(48px, env(safe-area-inset-bottom), var(--vv-bottom-chrome, 0px), 72px);
        }
    }
</style>