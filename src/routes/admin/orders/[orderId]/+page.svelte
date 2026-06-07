<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { supabase } from '$lib/supabase.js';
  import {
    computeCoverBaseSize,
    computeMaxTranslateFromBase,
    pctToTranslate,
    translateToPct,
    clamp
  } from '$lib/utils/cropMath.js';
  import { getCssFilter } from '$lib/stores.js';

  const orderId = $page.params.orderId;
  const FRAME = 340; // crop editor frame size in px

  /** @type {any} */
  let order = null;
  /** @type {any[]} */
  let items = [];
  /** @type {any} */
  let productionJob = null;
  let loading = true;
  let error = '';
  let statusLoading = false;
  let statusMsg = '';
  let emailLoading = false;
  let emailMsg = '';

  // Production job editing state
  let giftMsgDraft = '';
  let giftMsgSaving = false;
  let giftMsgStatus = '';
  let notesDraft = '';
  let notesSaving = false;
  let notesStatus = '';
  let releaseLoading = false;
  let releaseMsg = '';
  let markPaidLoading = false;
  let markPaidMsg = '';
  let uploadingGiftImage = false;
  let giftImageMsg = '';

  // ── Crop editor state ───────────────────────────────────────────────────────
  let cropOpen = false;
  let cropImageUrl = '';   // signed URL for the overridden image
  let cropLoading = false; // waiting for signed URL
  let cropSaving = false;
  let cropMsg = '';

  // transform
  let bgImgEl;
  let coverBaseW = 0;
  let coverBaseH = 0;
  let bgTranslateX = 0;
  let bgTranslateY = 0;
  let zoomMultiplier = 1;
  let cropEffect = 'original';
  let hasInitialized = false;
  let isDragging = false;
  let activePointerId = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragRafId = 0;
  let pendingDeltaX = 0;
  let pendingDeltaY = 0;
  let cropImageReady = false; // fade-in once decoded

  const EFFECTS = [
    { id: 'original', label: 'מקורי' },
    { id: 'silver',   label: 'כסף'   },
    { id: 'noir',     label: 'נואר'  },
    { id: 'vivid',    label: 'עז'    },
    { id: 'dramatic', label: 'דרמטי' }
  ];

  // ── Status / label maps ─────────────────────────────────────────────────────
  const STATUS_LABELS = {
    pending:         'ממתין לתשלום',
    paid:            'שולם',
    processing:      'בעיבוד מקדים',
    ready_for_print: 'מוכן להדפסה',
    printed:         'הודפס',
    shipped:         'נשלח',
    delivered:       'נמסר',
    cancelled:       'בוטל'
  };
  const STATUS_COLORS = {
    pending:         '#f5a623',
    paid:            '#4CAF50',
    processing:      '#ff9800',
    ready_for_print: '#4CAF50',
    printed:         '#2196F3',
    shipped:         '#9C27B0',
    delivered:       '#3f524f',
    cancelled:       '#e53935'
  };
  const TRANSITIONS = {
    pending:         ['cancelled'],
    processing:      ['cancelled'],
    ready_for_print: ['cancelled'],
    printed:         ['shipped', 'cancelled'],
    shipped:         ['delivered', 'cancelled'],
    delivered:       [],
    cancelled:       []
  };
  const TRANSITION_LABELS = {
    ready_for_print: 'שחרר להדפסה',
    shipped:         'סמן כנשלח',
    delivered:       'סמן כנמסר',
    cancelled:       'בטל הזמנה'
  };

  // ── Data loading ────────────────────────────────────────────────────────────
  async function loadDetail() {
    loading = true;
    error = '';
    const { data, error: rpcErr } = await supabase.rpc('admin_get_order_detail', {
      p_order_id: orderId
    });
    if (rpcErr) {
      error = 'שגיאה בטעינת ההזמנה.';
      loading = false;
      return;
    }
    order = data?.order ?? null;
    items = Array.isArray(data?.items) ? data.items : [];
    productionJob = data?.production_job ?? null;

    if (productionJob) {
      giftMsgDraft = productionJob.overridden_gift_message ?? '';
      notesDraft   = productionJob.admin_notes ?? '';
    }
    loading = false;
  }

  onMount(loadDetail);

  // ── Order status ────────────────────────────────────────────────────────────
  async function updateStatus(newStatus) {
    if (!confirm(`לשנות סטטוס ל"${STATUS_LABELS[newStatus]}"?`)) return;
    statusLoading = true;
    statusMsg = '';
    const { data, error: rpcErr } = await supabase.rpc('admin_update_order_status', {
      p_order_id: orderId,
      p_new_status: newStatus
    });
    if (rpcErr) {
      statusMsg = `שגיאה: ${rpcErr.message}`;
    } else {
      order = { ...order, status: data?.status ?? newStatus };
      statusMsg = `✓ סטטוס עודכן ל"${STATUS_LABELS[newStatus]}"`;
    }
    statusLoading = false;
  }

  // ── Shipping email ──────────────────────────────────────────────────────────
  async function sendShippingEmail() {
    if (!confirm('לשלוח מייל "ההזמנה בדרך" ללקוח?')) return;
    emailLoading = true;
    emailMsg = '';
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token ?? '';
      const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/send-shipping-notification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ order_id: orderId })
      });
      const body = await res.json().catch(() => ({}));
      emailMsg = res.ok
        ? '✓ מייל משלוח נשלח ללקוח'
        : `שגיאה בשליחת מייל: ${body?.error ?? res.status}`;
    } catch { emailMsg = 'שגיאת רשת — נסה שוב'; }
    emailLoading = false;
  }

  // ── Gift message ────────────────────────────────────────────────────────────
  async function saveGiftMessage() {
    giftMsgSaving = true;
    giftMsgStatus = '';
    const { data, error: rpcErr } = await supabase.rpc('admin_update_production_job', {
      p_order_id: orderId,
      p_overridden_gift_message: giftMsgDraft,
      p_gift_message_done: true
    });
    if (rpcErr) { giftMsgStatus = `שגיאה: ${rpcErr.message}`; }
    else { productionJob = data; giftMsgStatus = '✓ ברכה מטויבת נשמרה'; }
    giftMsgSaving = false;
  }

  async function saveAdminNotes() {
    notesSaving = true;
    notesStatus = '';
    const { data, error: rpcErr } = await supabase.rpc('admin_update_production_job', {
      p_order_id: orderId,
      p_admin_notes: notesDraft
    });
    if (rpcErr) { notesStatus = `שגיאה: ${rpcErr.message}`; }
    else { productionJob = data; notesStatus = '✓ הערות נשמרו'; }
    notesSaving = false;
  }

  async function releaseForPrint() {
    if (!confirm('לאשר הזמנה לייצור? ההזמנה תעבור לתור ההדפסה.')) return;
    releaseLoading = true;
    releaseMsg = '';
    const { data, error: rpcErr } = await supabase.rpc('admin_update_order_status', {
      p_order_id: orderId,
      p_new_status: 'ready_for_print'
    });
    if (rpcErr) { releaseMsg = `שגיאה: ${rpcErr.message}`; }
    else {
      order = { ...order, status: data?.status ?? 'ready_for_print' };
      releaseMsg = '✓ ההזמנה אושרה לייצור';
    }
    releaseLoading = false;
  }

  async function markAsPaid() {
    if (!confirm('לסמן הזמנה זו כשולמה (ביט)?')) return;
    markPaidLoading = true;
    markPaidMsg = '';
    const { data, error: rpcErr } = await supabase.rpc('admin_update_order_status', {
      p_order_id: orderId,
      p_new_status: 'paid'
    });
    if (rpcErr) { markPaidMsg = `שגיאה: ${rpcErr.message}`; }
    else {
      order = { ...order, status: data?.status };
      markPaidMsg = `✓ ההזמנה סומנה כשולמה → ${STATUS_LABELS[data?.status] ?? data?.status}`;
    }
    markPaidLoading = false;
  }

  // ── Gift image: download + upload ───────────────────────────────────────────
  async function downloadOriginalGiftImage() {
    const giftItem = items.find(i => i.item_type === 'gift');
    const path = giftItem?.original_storage_paths?.gift
               ?? giftItem?.original_storage_paths?.source;
    if (!path) { giftImageMsg = 'לא נמצא קובץ מקורי למתנה'; return; }
    const { data, error: dlErr } = await supabase.storage
      .from('order-originals').createSignedUrl(path, 3600);
    if (dlErr || !data?.signedUrl) { giftImageMsg = 'שגיאה ביצירת קישור הורדה'; return; }
    window.open(data.signedUrl, '_blank');
  }

  async function uploadEditedGiftImage(event) {
    const file = event.target?.files?.[0];
    if (!file) return;
    uploadingGiftImage = true;
    giftImageMsg = '';

    const ext = file.name.split('.').pop() || 'jpg';
    const storagePath = `${order.user_id}/Order-${order.order_number}/gift/gift_edited.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from('order-originals')
      .upload(storagePath, file, { upsert: true });

    if (uploadErr) {
      giftImageMsg = `שגיאת העלאה: ${uploadErr.message}`;
      uploadingGiftImage = false;
      return;
    }

    const { data, error: rpcErr } = await supabase.rpc('admin_update_production_job', {
      p_order_id: orderId,
      p_overridden_gift_image_path: storagePath,
      p_gift_image_done: true
    });
    if (rpcErr) { giftImageMsg = `שגיאה בשמירת הנתיב: ${rpcErr.message}`; }
    else { productionJob = data; giftImageMsg = '✓ תמונה מטויבת הועלתה בהצלחה'; }

    uploadingGiftImage = false;
    event.target.value = '';
  }

  // ── Crop editor: open / close ───────────────────────────────────────────────
  async function openCropEditor() {
    const path = productionJob?.overridden_gift_image_path;
    if (!path) { giftImageMsg = 'יש להעלות תמונה מטויבת לפני עריכת חיתוך'; return; }

    cropLoading = true;
    giftImageMsg = '';
    const { data, error: signErr } = await supabase.storage
      .from('order-originals')
      .createSignedUrl(path, 3600);
    cropLoading = false;

    if (signErr || !data?.signedUrl) { giftImageMsg = 'שגיאה בטעינת תמונה לעריכה'; return; }

    // Restore previously saved crop if any
    const saved = productionJob?.overridden_gift_crop;
    zoomMultiplier  = saved?.zoom   ?? 1;
    bgTranslateX    = 0;
    bgTranslateY    = 0;
    cropEffect      = saved?.effect ?? 'original';
    hasInitialized  = false;
    cropImageReady  = false;
    coverBaseW      = 0;
    coverBaseH      = 0;
    cropImageUrl    = data.signedUrl;
    cropMsg         = '';
    cropOpen        = true;
  }

  function closeCropEditor() {
    cropOpen     = false;
    cropImageUrl = '';
    cropImageReady = false;
    hasInitialized = false;
  }

  // ── Crop editor: image load ─────────────────────────────────────────────────
  function onCropImageLoad() {
    if (!bgImgEl) return;
    const nW = bgImgEl.naturalWidth  || 1;
    const nH = bgImgEl.naturalHeight || 1;
    const { baseW, baseH } = computeCoverBaseSize(nW, nH, FRAME);
    coverBaseW = baseW;
    coverBaseH = baseH;

    if (!hasInitialized) {
      hasInitialized = true;
      const saved = productionJob?.overridden_gift_crop;
      if (saved?.xPct != null) {
        const { maxX, maxY } = computeMaxTranslateFromBase(baseW, baseH, FRAME, zoomMultiplier);
        const t = pctToTranslate(saved.xPct, saved.yPct, maxX, maxY);
        bgTranslateX = t.x;
        bgTranslateY = t.y;
      } else {
        // default: top-align
        const { maxY } = computeMaxTranslateFromBase(baseW, baseH, FRAME, zoomMultiplier);
        bgTranslateX = 0;
        bgTranslateY = maxY;
      }
      clampTranslation();
    }
    cropImageReady = true;
  }

  function clampTranslation() {
    const { maxX, maxY } = computeMaxTranslateFromBase(coverBaseW, coverBaseH, FRAME, zoomMultiplier);
    bgTranslateX = clamp(bgTranslateX, -maxX, maxX);
    bgTranslateY = clamp(bgTranslateY, -maxY, maxY);
  }

  function handleZoomInput(e) {
    zoomMultiplier = parseFloat(e.target.value);
    if (coverBaseW && coverBaseH) clampTranslation();
  }

  // ── Crop editor: drag ───────────────────────────────────────────────────────
  function startDrag(e) {
    if (e.cancelable) e.preventDefault();
    if (activePointerId !== null) return;
    activePointerId = e.pointerId ?? null;
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    try { e.currentTarget?.setPointerCapture(activePointerId); } catch {}
  }

  function onDrag(e) {
    if (!isDragging) return;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    if (e.cancelable) e.preventDefault();
    pendingDeltaX += e.clientX - dragStartX;
    pendingDeltaY += e.clientY - dragStartY;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    if (!dragRafId) dragRafId = requestAnimationFrame(flushDrag);
  }

  function flushDrag() {
    dragRafId = 0;
    if (!isDragging) return;
    bgTranslateX += pendingDeltaX;
    bgTranslateY += pendingDeltaY;
    pendingDeltaX = 0;
    pendingDeltaY = 0;
    clampTranslation();
  }

  function endDrag(e) {
    if (activePointerId !== null && e?.pointerId !== activePointerId) return;
    activePointerId = null;
    isDragging = false;
    pendingDeltaX = pendingDeltaY = 0;
    if (dragRafId) { cancelAnimationFrame(dragRafId); dragRafId = 0; }
  }

  function resetCrop() {
    zoomMultiplier = 1;
    cropEffect = 'original';
    if (bgImgEl && coverBaseW && coverBaseH) {
      const { maxY } = computeMaxTranslateFromBase(coverBaseW, coverBaseH, FRAME, 1);
      bgTranslateX = 0;
      bgTranslateY = maxY;
    }
  }

  // ── Crop editor: save ───────────────────────────────────────────────────────
  async function saveCrop() {
    cropSaving = true;
    cropMsg = '';

    const { maxX, maxY } = computeMaxTranslateFromBase(coverBaseW, coverBaseH, FRAME, zoomMultiplier);
    const { xPct, yPct } = translateToPct(bgTranslateX, bgTranslateY, maxX, maxY);

    const cropData = {
      zoom:   zoomMultiplier,
      xPct:   clamp(xPct, -1, 1),
      yPct:   clamp(yPct, -1, 1),
      effect: cropEffect
    };

    const { data, error: rpcErr } = await supabase.rpc('admin_update_production_job', {
      p_order_id:             orderId,
      p_overridden_gift_crop: cropData
    });

    if (rpcErr) {
      cropMsg = `שגיאה: ${rpcErr.message}`;
    } else {
      productionJob = data;
      cropMsg = '✓ חיתוך ואפקט נשמרו';
    }
    cropSaving = false;
  }

  // ── Misc helpers ────────────────────────────────────────────────────────────
  function formatDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' }); }
    catch { return iso; }
  }

  function configSummary(cfg) {
    if (!cfg || typeof cfg !== 'object') return '';
    const parts = [];
    if (cfg.count) parts.push(`${cfg.count} יחידות`);
    const effect = cfg.settingsMeta?.currentEffect ?? cfg.effectId;
    if (effect && effect !== 'original') parts.push(`אפקט: ${effect}`);
    return parts.join(' · ');
  }

  $: cropFilterStyle = `filter:${getCssFilter(cropEffect)};`;
  $: cropTransformStyle = `transform:translate(-50%,-50%) translate(${bgTranslateX}px,${bgTranslateY}px) scale(${zoomMultiplier});`;
  $: cropImgStyle = `${cropFilterStyle}width:${coverBaseW ? coverBaseW + 'px' : 'auto'};height:${coverBaseH ? coverBaseH + 'px' : 'auto'};`;
</script>

<svelte:head>
  <title>FEEL Admin — הזמנה {order?.order_number ?? ''}</title>
</svelte:head>

<!-- ── Crop editor modal ────────────────────────────────────────────────────── -->
{#if cropOpen}
  <div class="crop-overlay" role="dialog" aria-modal="true" aria-label="עריכת חיתוך תמונת מתנה">
    <div class="crop-modal">
      <div class="crop-modal-header">
        <span class="crop-modal-title">✂️ עריכת חיתוך — תמונת מתנה</span>
        <button class="crop-close-btn" on:click={closeCropEditor} aria-label="סגור">✕</button>
      </div>

      <!-- Stage -->
      <div class="crop-stage-wrap">
        <div class="crop-image-layer">
          <div class="crop-movable" style={cropTransformStyle}>
            <img
              bind:this={bgImgEl}
              src={cropImageUrl}
              alt="gift crop"
              class="crop-img"
              class:crop-img--ready={cropImageReady}
              style={cropImgStyle}
              on:load={onCropImageLoad}
              loading="eager"
              decoding="async"
            />
          </div>
        </div>
        <!-- drag-capture mask with vignette hole -->
        <div
          class="crop-mask"
          on:pointerdown={startDrag}
          on:pointermove={onDrag}
          on:pointerup={endDrag}
          on:pointercancel={endDrag}
          role="presentation"
        >
          <div class="crop-hole" style="width:{FRAME}px;height:{FRAME}px;"></div>
        </div>
        {#if !cropImageReady}
          <div class="crop-skeleton"></div>
        {/if}
      </div>

      <!-- Zoom slider -->
      <div class="crop-controls">
        <div class="crop-zoom-row">
          <span class="crop-icon">−</span>
          <input type="range" min="1" max="3" step="0.01"
            value={zoomMultiplier}
            on:input={handleZoomInput}
            aria-label="זום"
            dir="ltr"
          />
          <span class="crop-icon">+</span>
        </div>
        <p class="crop-hint">גרור לשינוי מיקום · סליידר לזום</p>
      </div>

      <!-- Effects row -->
      <div class="crop-effects-row">
        {#each EFFECTS as eff}
          <button
            class="crop-effect-btn"
            class:crop-effect-btn--active={cropEffect === eff.id}
            on:click={() => cropEffect = eff.id}
          >{eff.label}</button>
        {/each}
      </div>

      <!-- Actions -->
      <div class="crop-actions">
        <button class="admin-btn admin-btn--secondary" on:click={resetCrop}>אפס</button>
        <button class="admin-btn admin-btn--secondary" on:click={closeCropEditor}>ביטול</button>
        <button class="admin-btn" on:click={saveCrop} disabled={cropSaving || !cropImageReady}>
          {cropSaving ? 'שומר…' : '💾 שמור חיתוך ואפקט'}
        </button>
      </div>
      {#if cropMsg}
        <p class="msg {cropMsg.startsWith('✓') ? 'msg--ok' : 'msg--err'} crop-msg">{cropMsg}</p>
      {/if}
    </div>
  </div>
{/if}

<!-- ── Page ─────────────────────────────────────────────────────────────────── -->
<div class="admin-page">
  <a href="/admin" class="back-link">← כל ההזמנות</a>

  {#if loading}
    <p class="admin-hint">טוען…</p>
  {:else if error}
    <p class="admin-error">{error}</p>
  {:else if order}
    <div class="order-header">
      <div>
        <h1 class="order-title">הזמנה #{order.order_number}</h1>
        <span class="status-badge"
          style="background:{STATUS_COLORS[order.status]}22;color:{STATUS_COLORS[order.status]};border-color:{STATUS_COLORS[order.status]}44;">
          {STATUS_LABELS[order.status] ?? order.status}
        </span>
      </div>
      <p class="order-date">{formatDate(order.placed_at)}</p>
    </div>

    <!-- Release Gate (gift orders in processing) -->
    {#if order.status === 'processing'}
      {@const msgDone = productionJob?.gift_message_done ?? false}
      {@const imgDone = productionJob?.gift_image_done   ?? !order.gift_enabled}
      {@const allDone = msgDone && imgDone}
      <div class="section section--release">
        <p class="release-hint">הזמנת מתנה — יש לבצע את כל המשימות לפני שחרור להדפסה:</p>
        <div class="subtask-list">
          <label class="subtask-item">
            <input type="checkbox" checked={msgDone} disabled on:change={() => {}} />
            <span>ברכה מטויבת</span>
            {#if msgDone}<span class="subtask-done">✓</span>{/if}
          </label>
          <label class="subtask-item">
            <input type="checkbox" checked={imgDone} disabled on:change={() => {}} />
            <span>תמונת מתנה מטויבת</span>
            {#if imgDone}<span class="subtask-done">✓</span>{/if}
          </label>
        </div>
        <button class="release-btn" disabled={releaseLoading || !allDone} on:click={releaseForPrint}>
          {releaseLoading ? 'מאשר…' : '🚀 שחרר לתור ההדפסה'}
        </button>
        {#if !allDone}<p class="release-hint release-hint--warn">יש להשלים את כל המשימות לפני השחרור</p>{/if}
        {#if releaseMsg}<p class="msg {releaseMsg.startsWith('✓') ? 'msg--ok' : 'msg--err'}">{releaseMsg}</p>{/if}
      </div>
    {/if}

    <!-- Mark as Paid (Bit) -->
    {#if order.status === 'pending'}
      <div class="section section--release">
        <button class="admin-btn" disabled={markPaidLoading} on:click={markAsPaid}>
          {markPaidLoading ? 'מעדכן…' : '💰 סמן כשולם (ביט)'}
        </button>
        <p class="release-hint">לתשלומי ביט שאושרו ידנית</p>
        {#if markPaidMsg}<p class="msg {markPaidMsg.startsWith('✓') ? 'msg--ok' : 'msg--err'}">{markPaidMsg}</p>{/if}
      </div>
    {/if}

    <!-- Actions -->
    <div class="section">
      <h2 class="section-title">פעולות</h2>
      <div class="actions-row">
        {#each TRANSITIONS[order.status] ?? [] as nextStatus}
          <button class="admin-btn {nextStatus === 'cancelled' ? 'admin-btn--danger' : ''}"
            disabled={statusLoading} on:click={() => updateStatus(nextStatus)}>
            {TRANSITION_LABELS[nextStatus]}
          </button>
        {/each}
        {#if order.status === 'shipped'}
          <button class="admin-btn admin-btn--secondary" disabled={emailLoading} on:click={sendShippingEmail}>
            {emailLoading ? 'שולח…' : '📧 שלח מייל "ההזמנה בדרך"'}
          </button>
        {/if}
      </div>
      {#if statusMsg}<p class="msg {statusMsg.startsWith('✓') ? 'msg--ok' : 'msg--err'}">{statusMsg}</p>{/if}
      {#if emailMsg}<p class="msg {emailMsg.startsWith('✓') ? 'msg--ok' : 'msg--err'}">{emailMsg}</p>{/if}
    </div>

    <!-- Shipping -->
    <div class="section">
      <h2 class="section-title">פרטי משלוח</h2>
      <div class="info-grid">
        <div class="info-row"><span class="info-label">שם</span><span>{order.shipping_first_name} {order.shipping_last_name}</span></div>
        <div class="info-row"><span class="info-label">כתובת</span><span>{order.shipping_street} {order.shipping_house_number}{order.shipping_apartment_number ? '/' + order.shipping_apartment_number : ''}, {order.shipping_city}</span></div>
        {#if order.shipping_notes}<div class="info-row"><span class="info-label">הערות</span><span>{order.shipping_notes}</span></div>{/if}
      </div>
    </div>

    <!-- Gift -->
    {#if order.gift_enabled}
      <div class="section section--gift">
        <h2 class="section-title">🎁 מתנה — נדרש מגנט נוסף</h2>
        <div class="info-grid">
          {#if order.gift_sender_name}<div class="info-row"><span class="info-label">שולח</span><span>{order.gift_sender_name}</span></div>{/if}
          {#if order.gift_sender_phone}<div class="info-row"><span class="info-label">טלפון</span><span>{order.gift_sender_phone}</span></div>{/if}
        </div>

        <!-- Gift Image Actions -->
        <div class="gift-actions">
          <h3 class="subsection-title">תמונת מתנה</h3>
          <div class="actions-row">
            <button class="admin-btn admin-btn--secondary" on:click={downloadOriginalGiftImage}>
              הורד תמונת מקור
            </button>
            <label class="admin-btn admin-btn--secondary upload-label">
              {uploadingGiftImage ? 'מעלה…' : 'העלה תמונה מטויבת'}
              <input type="file" accept="image/*" class="sr-only"
                on:change={uploadEditedGiftImage} disabled={uploadingGiftImage} />
            </label>
            <button
              class="admin-btn"
              on:click={openCropEditor}
              disabled={cropLoading || !productionJob?.overridden_gift_image_path}
              title={!productionJob?.overridden_gift_image_path ? 'יש להעלות תמונה מטויבת תחילה' : ''}
            >
              {cropLoading ? 'טוען…' : '✂️ ערוך חיתוך'}
            </button>
          </div>
          {#if productionJob?.overridden_gift_image_path}
            <p class="override-indicator">✓ תמונה מטויבת: {productionJob.overridden_gift_image_path.split('/').pop()}</p>
          {/if}
          {#if productionJob?.overridden_gift_crop}
            {@const c = productionJob.overridden_gift_crop}
            <p class="override-indicator">✓ חיתוך: זום {c.zoom?.toFixed(2)}x · אפקט: {c.effect ?? 'מקורי'}</p>
          {/if}
          {#if giftImageMsg}<p class="msg {giftImageMsg.startsWith('✓') ? 'msg--ok' : 'msg--err'}">{giftImageMsg}</p>{/if}
        </div>
      </div>
    {/if}

    <!-- Greeting / ברכה -->
    {#if order.gift_message}
      <div class="section section--greeting">
        <h2 class="section-title">✉️ ברכה — נדרשת הדפסת טקסט</h2>
        <p class="greeting-label">מקור (קריאה בלבד):</p>
        <div class="greeting-text greeting-text--readonly">{order.gift_message}</div>
        <p class="greeting-label greeting-label--override">ברכה מטויבת:</p>
        <textarea class="greeting-textarea" bind:value={giftMsgDraft}
          placeholder="הקלד כאן את הברכה המטויבת…" dir="rtl"></textarea>
        <div class="actions-row" style="margin-top:8px;">
          <button class="admin-btn" on:click={saveGiftMessage} disabled={giftMsgSaving}>
            {giftMsgSaving ? 'שומר…' : 'שמור טיוב ברכה'}
          </button>
        </div>
        {#if giftMsgStatus}<p class="msg {giftMsgStatus.startsWith('✓') ? 'msg--ok' : 'msg--err'}">{giftMsgStatus}</p>{/if}
      </div>
    {/if}

    <!-- Admin Notes -->
    <div class="section">
      <h2 class="section-title">הערות אדמין</h2>
      <textarea class="notes-textarea" bind:value={notesDraft}
        placeholder="הערות פנימיות להזמנה זו…" dir="rtl"></textarea>
      <div class="actions-row" style="margin-top:8px;">
        <button class="admin-btn" on:click={saveAdminNotes} disabled={notesSaving}>
          {notesSaving ? 'שומר…' : 'שמור הערות'}
        </button>
      </div>
      {#if notesStatus}<p class="msg {notesStatus.startsWith('✓') ? 'msg--ok' : 'msg--err'}">{notesStatus}</p>{/if}
    </div>

    <!-- Items -->
    <div class="section">
      <h2 class="section-title">פריטים</h2>
      <div class="items-list">
        {#each items as item}
          <div class="item-card" class:item-card--gift={item.item_type === 'gift'}>
            {#if item.thumbnail_url}
              <img class="item-thumb" src={item.thumbnail_url} alt={item.title} loading="lazy" />
            {:else}
              <div class="item-thumb item-thumb--placeholder">📷</div>
            {/if}
            <div class="item-info">
              <p class="item-title">
                {item.title ?? '—'}
                {#if item.item_type === 'gift'}
                  <span class="gift-item-badge">🎁 מגנט מתנה</span>
                {/if}
              </p>
              <p class="item-sub">{item.subtitle ?? ''}</p>
              <p class="item-meta">{configSummary(item.configuration)}</p>
            </div>
            <div class="item-price">₪{Number(item.line_total || 0).toLocaleString('he-IL')}</div>
          </div>
        {/each}
      </div>
    </div>

    <!-- Totals -->
    <div class="section section--totals">
      <h2 class="section-title">תשלום</h2>
      <div class="info-grid">
        <div class="info-row"><span class="info-label">סכום ביניים</span><span>₪{Number(order.subtotal_amount||0).toLocaleString('he-IL')}</span></div>
        <div class="info-row"><span class="info-label">משלוח</span><span>₪{Number(order.shipping_amount||0).toLocaleString('he-IL')}</span></div>
        <div class="info-row info-row--total"><span class="info-label">סה"כ</span><span class="total-amount">₪{Number(order.total_amount||0).toLocaleString('he-IL')}</span></div>
      </div>
    </div>
  {/if}
</div>

<style>
  /* ── Page ────────────────────────────────────────────────────────────────── */
  .admin-page { max-width: 860px; margin: 0 auto; }
  .back-link { display:inline-block; margin-bottom:20px; color:#3f524f; text-decoration:none; font-size:14px; }
  .back-link:hover { text-decoration:underline; }

  .order-header { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:24px; flex-wrap:wrap; gap:8px; }
  .order-title { font-size:24px; font-weight:800; color:#1e1e1e; margin:0 0 6px; }
  .order-date { color:#888; font-size:13px; margin:0; }

  .status-badge { display:inline-block; padding:4px 12px; border-radius:12px; font-size:13px; font-weight:700; border:1px solid transparent; margin-inline-end:6px; }

  .section { background:#fff; border-radius:10px; padding:20px; margin-bottom:16px; box-shadow:0 1px 4px rgba(0,0,0,0.07); }
  .section-title { font-size:13px; font-weight:800; letter-spacing:0.05em; text-transform:uppercase; color:#3f524f; margin:0 0 14px; }
  .subsection-title { font-size:12px; font-weight:700; color:#3f524f; margin:14px 0 8px; }

  .actions-row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }

  .admin-btn { background:#3f524f; color:#fff; border:none; border-radius:6px; padding:8px 18px; font-size:14px; cursor:pointer; transition:opacity 0.15s; min-height:44px; }
  .admin-btn:hover:not(:disabled) { opacity:0.85; }
  .admin-btn:disabled { opacity:0.4; cursor:default; }
  .admin-btn--danger { background:#e53935; }
  .admin-btn--secondary { background:#C6B29A; color:#1e1e1e; }

  .msg { font-size:13px; margin:10px 0 0; padding:6px 10px; border-radius:6px; }
  .msg--ok { background:#e8f5e9; color:#2e7d32; }
  .msg--err { background:#ffeaea; color:#c62828; }

  .info-grid { display:flex; flex-direction:column; gap:8px; }
  .info-row { display:flex; gap:12px; font-size:14px; align-items:baseline; }
  .info-label { font-weight:700; color:#3f524f; min-width:80px; flex-shrink:0; }
  .info-row--total { margin-top:8px; border-top:1px solid #f0ede9; padding-top:10px; }
  .total-amount { font-size:18px; font-weight:800; color:#1e1e1e; }

  .items-list { display:flex; flex-direction:column; gap:16px; }
  .item-card { display:flex; gap:16px; align-items:flex-start; border-bottom:1px solid #f0ede9; padding-bottom:16px; }
  .item-card:last-child { border-bottom:none; padding-bottom:0; }
  .item-thumb { width:72px; height:72px; object-fit:cover; border-radius:6px; flex-shrink:0; border:1px solid #e0ddd8; }
  .item-thumb--placeholder { display:flex; align-items:center; justify-content:center; font-size:28px; background:#f5f0e8; border:1px dashed #c6b29a; }
  .item-info { flex:1; min-width:0; }
  .item-title { font-weight:700; font-size:15px; margin:0 0 3px; color:#1e1e1e; }
  .item-sub { font-size:13px; color:#666; margin:0 0 4px; }
  .item-meta { font-size:12px; color:#888; margin:0 0 8px; }
  .item-price { font-weight:700; font-size:15px; color:#3f524f; white-space:nowrap; padding-top:2px; }
  .item-card--gift { background:#fff8e1; border:1px solid #ffcc80; border-radius:8px; padding:12px; margin:-4px -4px 12px; }
  .gift-item-badge { display:inline-block; background:#fff3e0; color:#e65100; font-size:11px; font-weight:700; padding:2px 8px; border-radius:10px; border:1px solid #ffcc80; margin-inline-start:8px; vertical-align:middle; }

  .section--gift { border:2px solid #ffcc80; background:#fff8e1; }
  .section--greeting { border:2px solid #a5d6a7; background:#e8f5e9; }
  .section--release { border:2px solid #ff9800; background:#fff3e0; text-align:center; padding:24px 20px; }

  .release-btn { background:#ff9800; color:#fff; border:none; border-radius:8px; padding:14px 32px; font-size:18px; font-weight:800; cursor:pointer; transition:background 0.15s; }
  .release-btn:hover:not(:disabled) { background:#f57c00; }
  .release-btn:disabled { opacity:0.5; cursor:default; }
  .release-hint { font-size:13px; color:#e65100; margin:10px 0 0; }
  .release-hint--warn { font-weight:700; }
  .subtask-list { display:flex; flex-direction:column; gap:8px; margin:12px 0; text-align:right; }
  .subtask-item { display:flex; align-items:center; gap:8px; font-size:14px; cursor:default; }
  .subtask-item input[type=checkbox] { width:18px; height:18px; accent-color:#4CAF50; }
  .subtask-done { color:#4CAF50; font-weight:700; }

  .greeting-label { font-size:12px; font-weight:700; color:#3f524f; margin:0 0 6px; }
  .greeting-label--override { margin-top:14px; }
  .greeting-text { font-size:16px; line-height:1.6; color:#1e1e1e; background:#fff; padding:14px 18px; border-radius:8px; border:1px solid #c8e6c9; white-space:pre-wrap; direction:rtl; }
  .greeting-text--readonly { opacity:0.7; }
  .greeting-textarea { width:100%; min-height:80px; font-size:15px; line-height:1.6; padding:12px 16px; border-radius:8px; border:2px solid #4CAF50; background:#fff; resize:vertical; font-family:inherit; box-sizing:border-box; }
  .greeting-textarea:focus { outline:none; border-color:#2e7d32; box-shadow:0 0 0 3px rgba(76,175,80,0.15); }
  .notes-textarea { width:100%; min-height:60px; font-size:14px; line-height:1.5; padding:10px 14px; border-radius:6px; border:1px solid #ddd; background:#fff; resize:vertical; font-family:inherit; box-sizing:border-box; }
  .notes-textarea:focus { outline:none; border-color:#3f524f; box-shadow:0 0 0 3px rgba(63,82,79,0.1); }

  .gift-actions { margin-top:12px; padding-top:12px; border-top:1px solid #ffcc80; }
  .upload-label { display:inline-flex; align-items:center; cursor:pointer; }
  .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
  .override-indicator { font-size:12px; color:#2e7d32; margin:8px 0 0; background:#e8f5e9; display:inline-block; padding:3px 8px; border-radius:4px; margin-inline-end:6px; }

  .admin-hint { color:#888; font-size:14px; text-align:center; padding:40px 0; margin:0; }
  .admin-error { color:#e53935; font-size:14px; padding:12px; background:#ffeaea; border-radius:6px; }

  /* ── Crop Editor Modal ───────────────────────────────────────────────────── */
  .crop-overlay {
    position: fixed;
    inset: 0;
    z-index: 9000;
    background: rgba(0,0,0,0.78);
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(4px);
    padding: 16px;
    box-sizing: border-box;
  }

  .crop-modal {
    background: #fff;
    border-radius: 14px;
    width: 100%;
    max-width: 480px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 24px 60px rgba(0,0,0,0.45);
  }

  .crop-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid #eee;
    background: #fafafa;
  }
  .crop-modal-title { font-size: 15px; font-weight: 800; color: #1e1e1e; }
  .crop-close-btn { background: none; border: none; font-size: 20px; cursor: pointer; color: #888; line-height: 1; padding: 4px; }
  .crop-close-btn:hover { color: #333; }

  /* Stage: fixed height so the modal fits the screen */
  .crop-stage-wrap {
    position: relative;
    width: 100%;
    height: 340px;
    background: #1a1a1a;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .crop-image-layer {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: visible;
    z-index: 1;
  }

  .crop-movable {
    position: absolute;
    left: 50%;
    top: 50%;
    transform-origin: center center;
    will-change: transform;
  }

  .crop-img {
    display: block;
    max-width: none;
    max-height: none;
    user-select: none;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.3s ease;
  }
  .crop-img--ready { opacity: 1; }

  /* Capture overlay with centered vignette hole */
  .crop-mask {
    position: absolute;
    inset: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: grab;
    touch-action: none;
  }
  .crop-mask:active { cursor: grabbing; }

  .crop-hole {
    box-shadow: 0 0 0 9999px rgba(0,0,0,0.55);
    border: 2px solid rgba(255,255,255,0.6);
    background: transparent;
    pointer-events: none;
    border-radius: 2px;
  }

  .crop-skeleton {
    position: absolute;
    inset: 0;
    z-index: 20;
    background: linear-gradient(90deg, #1a1a1a 25%, #2a2a2a 50%, #1a1a1a 75%);
    background-size: 200% 100%;
    animation: cropSkeletonPulse 1.4s infinite;
  }
  @keyframes cropSkeletonPulse {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  .crop-controls {
    padding: 12px 20px 4px;
    background: #fff;
  }

  .crop-zoom-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .crop-icon { font-weight: 800; color: #555; font-size: 18px; width: 18px; text-align: center; user-select: none; }
  .crop-zoom-row input {
    flex: 1;
    height: 6px;
    background: rgba(0,0,0,0.12);
    border-radius: 999px;
    -webkit-appearance: none;
    appearance: none;
    outline: none;
    direction: ltr;
  }
  .crop-zoom-row input::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 22px; height: 22px;
    border-radius: 50%;
    background: #3f524f;
    border: 2px solid #fff;
    box-shadow: 0 2px 6px rgba(0,0,0,0.2);
  }
  .crop-zoom-row input::-moz-range-thumb {
    width: 22px; height: 22px;
    border-radius: 50%;
    background: #3f524f;
    border: 2px solid #fff;
  }
  .crop-hint { font-size: 12px; color: #888; text-align: center; margin: 6px 0 0; }

  .crop-effects-row {
    display: flex;
    gap: 6px;
    padding: 10px 20px;
    border-top: 1px solid #f0f0f0;
    border-bottom: 1px solid #f0f0f0;
    background: #fafafa;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .crop-effects-row::-webkit-scrollbar { display: none; }

  .crop-effect-btn {
    flex-shrink: 0;
    background: #fff;
    border: 1.5px solid #ddd;
    border-radius: 20px;
    padding: 5px 14px;
    font-size: 13px;
    font-weight: 600;
    color: #555;
    cursor: pointer;
    transition: all 0.15s;
  }
  .crop-effect-btn:hover { border-color: #3f524f; color: #3f524f; }
  .crop-effect-btn--active {
    background: #3f524f;
    border-color: #3f524f;
    color: #fff;
  }

  .crop-actions {
    display: flex;
    gap: 10px;
    padding: 14px 20px;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  .crop-msg { margin: 0 20px 14px; }
</style>
