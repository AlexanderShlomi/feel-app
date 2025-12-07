<script>
    import '../app.css'; 
    import Header from '$lib/components/Header.svelte';
    import SideMenu from '$lib/components/SideMenu.svelte';
    import CartCounter from '$lib/components/CartCounter.svelte';
 
    
    // מחקנו את השורה של GiftButton מכאן

    let isMenuOpen = false;
    function toggleMenu() {
        isMenuOpen = !isMenuOpen;
    }
</script>

<div class="page-container" dir="rtl">
    
    <Header on:toggleMenu={toggleMenu} />
    <SideMenu bind:isOpen={isMenuOpen} />
    <CartCounter />
    
    <slot />

</div>