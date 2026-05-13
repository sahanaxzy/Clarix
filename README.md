# Clarix

An AI-powered study material search engine. Upload PDFs, documents, and links — then search by meaning or ask questions. Answers come from what's actually inside your materials.

![Clarix UI](screenshots/clarix-ui.png)

## Run locally

```bash
npm install
npm run dev
```

For AI-powered answers, get a free [Gemini API key](https://aistudio.google.com/apikey) and add it to a `.env` file:

```env
VITE_GEMINI_API_KEY=your_api_key_here
```

## How it works

- Files are read in the browser and text is extracted (PDF, DOCX, plain text, HTML).
- Content is split into chunks and embedded locally using an on-device transformer model (Xenova/all-MiniLM-L6-v2) to enable semantic search.
- You can ask questions about your uploads — with a Gemini API key, you get full generative AI answers grounded in your files. Without a key, Clarix finds and returns the most relevant passages on-device.
- Your library is stored in IndexedDB on your device. Nothing leaves your browser unless you configure an API key.

## Notes

- Link indexing uses a read-only fetch proxy (`https://r.jina.ai/…`) to retrieve public page content in a browser-friendly way.
- First-time model loading can take a bit longer; after that, it's cached.
- Supports PDF, DOCX, TXT, MD, RTF, and HTML files. Drag & drop is supported.
