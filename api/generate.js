// Fungsi untuk memanggil API Teks Google
async function generateSlideContent(topic, apiKey) {
    const systemPrompt = `Anda adalah ahli dalam membuat presentasi. Buatlah slide deck berdasarkan topik pengguna. Untuk setiap slide, berikan judul, konten berupa daftar poin-poin, catatan pembicara, dan prompt gambar yang singkat dan deskriptif (5-10 kata) untuk model text-to-image. Prompt gambar harus menangkap esensi visual dari konten slide. Hasilkan antara 5 dan 8 slide. Output harus dalam format JSON yang sesuai dengan skema.`;
    const userQuery = `Buat presentasi dengan topik: "${topic}"`;
    const schema = {type: "OBJECT", properties: {presentationTitle: { "type": "STRING" }, slides: {type: "ARRAY", items: {type: "OBJECT", properties: {title: { "type": "STRING" }, content: {type: "ARRAY", items: { "type": "STRING" }}, speakerNotes: { "type": "STRING"}, imagePrompt: { "type": "STRING"}}, required: ["title", "content", "speakerNotes", "imagePrompt"]}}}, required: ["presentationTitle", "slides"]};
    const payload = {contents: [{ parts: [{ text: userQuery }] }], systemInstruction: { parts: [{ text: systemPrompt }] }, generationConfig: {responseMimeType: "application/json", responseSchema: schema}};
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)});
    if (!response.ok) { throw new Error(`API Error (Text): ${response.status} ${response.statusText}`);}
    const result = await response.json();
    const candidate = result.candidates?.[0];
    if (candidate && candidate.content?.parts?.[0]?.text) { return JSON.parse(candidate.content.parts[0].text);} else { throw new Error("Respons dari AI teks tidak valid.");}
}

// Fungsi untuk memanggil API Gambar Google
async function generateImageFromPrompt(prompt, style, apiKey) {
    const fullPrompt = style === 'realistic' ? `A cinematic, photorealistic, high-quality photograph of: ${prompt}.` : `A clean, simple, illustrative, digital art style, vector illustration of: ${prompt}.`;
    const payload = {contents: [{parts: [{ text: fullPrompt }]}], generationConfig: {responseModalities: ['IMAGE']},};
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent?key=${apiKey}`;
    
    const response = await fetch(apiUrl, {method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)});
    if (!response.ok) throw new Error(`API Error (Image): ${response.status}`);
    const result = await response.json();
    const base64Data = result?.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
    if (base64Data) { return `data:image/png;base64,${base64Data}`;} 
    else {
        const safetyRatings = result?.candidates?.[0]?.safetyRatings;
        if (safetyRatings) { console.warn('Image generation blocked:', safetyRatings); throw new Error("Gambar diblokir oleh filter keamanan.");}
        throw new Error("Respons data gambar tidak valid.");
    }
}


// Handler utama untuk serverless function di Vercel
export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Metode tidak diizinkan' });
    }

    try {
        const { topic, imageStyle } = request.body;
        if (!topic || !imageStyle) {
            return response.status(400).json({ error: 'Topik dan gaya gambar diperlukan' });
        }
        
        // Ambil API key dari environment variable yang aman
        const apiKey = process.env.GOOGLE_API_KEY;
        if (!apiKey) {
            throw new Error("GOOGLE_API_KEY tidak diatur di server.");
        }

        // 1. Buat konten teks dan prompt gambar
        const presentationContent = await generateSlideContent(topic, apiKey);
        let slides = presentationContent.slides;

        if (!slides || slides.length === 0) {
            throw new Error("AI tidak berhasil membuat konten slide.");
        }

        // 2. Buat semua gambar secara paralel
        const imagePromises = slides.map(slide => 
            generateImageFromPrompt(slide.imagePrompt, imageStyle, apiKey)
                .catch(e => {
                    console.error(`Gagal membuat gambar untuk prompt: "${slide.imagePrompt}". Error: ${e.message}`);
                    return 'https://placehold.co/800x450/e2e8f0/94a3b8?text=Gagal+memuat+gambar'; // Fallback image
                })
        );
        const imageUrls = await Promise.all(imagePromises);

        // 3. Gabungkan URL gambar kembali ke data slide
        slides.forEach((slide, index) => {
            slide.imageUrl = imageUrls[index];
        });

        // 4. Kirim hasil lengkap kembali ke frontend
        response.status(200).json(presentationContent);

    } catch (error) {
        console.error('Kesalahan di Backend:', error);
        response.status(500).json({ error: error.message });
    }
}
