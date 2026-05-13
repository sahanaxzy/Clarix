# Study Material Search

A sleek local library for your study materials. Upload PDFs and documents, save links, and search by meaning based on the actual content inside your materials.

## Run locally

```bash
npm install
npm run dev
```

## How it works

- Files are read in the browser and text is extracted (PDF/DOCX/plain text).
- Content is split into chunks and embedded locally to enable natural language search.
- Your library is stored in IndexedDB on your device.

## Notes

- Link indexing uses a read-only fetch proxy (`https://r.jina.ai/…`) to retrieve public page content in a browser-friendly way.
- First-time model loading can take a bit longer; after that, it’s cached.

# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
