<script>
    import { createEventDispatcher } from 'svelte';
    
    export let mode = 'multi'; // 'multi' or 'split'
    export let uploadId = 'file-upload';
    
    const dispatch = createEventDispatcher();

    function handleChange(event) {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        dispatch('uploadStart');

        if (mode === 'multi') {
            // מעבירים את ה-Files כמו שהם, ללא המרה ל-Base64
            dispatch('filesSelected', files);
        } else {
            // מצב פסיפס - טעינה מהירה
            const file = files[0];
            // יצירת URL זמני לתמונה
            const objectUrl = URL.createObjectURL(file);
            
            const img = new Image();
            img.onload = () => {
                dispatch('splitImageLoaded', {
                    src: objectUrl,
                    ratio: img.naturalWidth / img.naturalHeight,
                    originalFile: file // שומרים את המקור למקרה הצורך
                });
            };
            img.src = objectUrl;
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