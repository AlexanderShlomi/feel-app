<script>
    import '../app.css'; // טוען את כל העיצוב
    import Header from '$lib/components/Header.svelte';
    import SideMenu from '$lib/components/SideMenu.svelte';

    // משתנה שינהל את מצב התפריט
    let isMenuOpen = false;

    function toggleMenu() {
        isMenuOpen = !isMenuOpen;
    }
</script>

<div class="page-container" dir="rtl">
    
    <Header on:toggleMenu={toggleMenu} />
    <SideMenu bind:isOpen={isMenuOpen} />

    <slot />

</div>