<script>
    import { createEventDispatcher } from 'svelte';
    
    export let mode = 'multi'; // 'multi' or 'split'
    export let uploadId = 'file-upload';
    
    const dispatch = createEventDispatcher();

    function decodeRatioFromObjectUrl(url) {
        return new Promise((resolve) => {
            const img = new Image();
            img.decoding = 'async';
            img.onload = () => {
                const w = img.naturalWidth || 0;
                const h = img.naturalHeight || 0;
                resolve(w && h ? (w / h) : 1);
            };
            img.onerror = () => resolve(1);
            img.src = url;
        });
    }

    async function handleChange(event) {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        dispatch('uploadStart');

        if (mode === 'multi') {
            // מעבירים את ה-Files כמו שהם, ללא המרה ל-Base64
            dispatch('filesSelected', files);
        } else {
            // מצב פסיפס - טעינה מהירה
            const file = files[0];
            // Show immediately (raw object URL). Any heavier normalization happens in the parent.
            const objectUrl = URL.createObjectURL(file);
            const ratio = await decodeRatioFromObjectUrl(objectUrl);
            dispatch('splitImageLoaded', { src: objectUrl, ratio, originalFile: file });
        }

        event.target.value = ''; // מאפשר העלאה של אותו קובץ שוב
    }
</script>

<input 
    type="file" 
    id={uploadId}
    multiple={mode === 'multi'}
    accept="image/*" 
    style="display: none;"
    on:change={handleChange}
>