<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/supabase.js';

  let checking = true;
  let allowed = false;

  onMount(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session?.user) {
      goto('/');
      return;
    }
    const { data, error } = await supabase.rpc('is_admin');
    if (error || !data) {
      goto('/');
      return;
    }
    allowed = true;
    checking = false;
  });
</script>

{#if checking}
  <div class="admin-loading" aria-label="בודק הרשאות…">
    <div class="spinner"></div>
  </div>
{:else if allowed}
  <div class="admin-shell" dir="rtl">
    <nav class="admin-nav">
      <a href="/admin" class="admin-nav-logo">FEEL Admin</a>
      <a href="/admin" class="admin-nav-link">הזמנות</a>
      <a href="/admin/print" class="admin-nav-link">הדפסה</a>
      <a href="/" class="admin-nav-link admin-nav-link--subtle">← לאתר</a>
    </nav>
    <main class="admin-main">
      <slot />
    </main>
  </div>
{/if}

<style>
  :global(body) {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #f5f5f5;
  }

  .admin-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
  }

  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid #ddd;
    border-top-color: #3f524f;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .admin-shell {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .admin-nav {
    background: #3f524f;
    color: #fff;
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 0 24px;
    height: 52px;
    position: sticky;
    top: 0;
    z-index: 100;
  }

  .admin-nav-logo {
    font-weight: 800;
    font-size: 16px;
    color: #C6B29A;
    text-decoration: none;
    letter-spacing: 0.05em;
    margin-left: auto;
  }

  .admin-nav-link {
    color: #e0e0e0;
    text-decoration: none;
    font-size: 14px;
    padding: 4px 8px;
    border-radius: 4px;
    transition: background 0.15s;
  }

  .admin-nav-link:hover {
    background: rgba(255,255,255,0.1);
    color: #fff;
  }

  .admin-nav-link--subtle {
    color: #aaa;
    font-size: 13px;
  }

  .admin-main {
    padding: 24px;
    flex: 1;
  }
</style>
