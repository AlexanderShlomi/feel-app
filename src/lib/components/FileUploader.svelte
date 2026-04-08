<script>
    import { createEventDispatcher } from 'svelte';
    import { normalizeImageFileToBlobUrl } from '$lib/utils/normalizeImage.js';
    
    export let mode = 'multi'; // 'multi' or 'split'
    export let uploadId = 'file-upload';
    
    const dispatch = createEventDispatcher();

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
            // Normalize EXIF orientation so mosaic crop/render math stays consistent on iOS.
            try {
                const norm = await normalizeImageFileToBlobUrl(file, { maxDim: 5200, quality: 0.95, mimeType: 'image/jpeg' });
                const src = norm?.url || URL.createObjectURL(file);
                const ratio = norm?.ratio || 1;
                dispatch('splitImageLoaded', { src, ratio, originalFile: file });
            } catch {
                const objectUrl = URL.createObjectURL(file);
                const img = new Image();
                img.onload = () => {
                    dispatch('splitImageLoaded', {
                        src: objectUrl,
                        ratio: img.naturalWidth / img.naturalHeight,
                        originalFile: file
                    });
                };
                img.src = objectUrl;
            }
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