import { clearAll, getAll, put, remove } from './db'
import { chunkText, extractTextFromFile, extractTextFromLink, normalizeText } from './text'
import { cosine, lexicalScore, snippetAround, tokenize, topK } from './search'

function id() {
  return globalThis.crypto?.randomUUID?.() || `m_${Math.random().toString(16).slice(2)}_${Date.now()}`
}

function inferTitleFromName(name) {
  const base = String(name || 'Untitled')
  return base.replace(/\.[a-z0-9]+$/i, '').trim() || 'Untitled'
}

function sourceLabelFromFile(file) {
  const name = file?.name || 'File'
  const size = typeof file?.size === 'number' ? file.size : 0
  const kb = size ? `${Math.max(1, Math.round(size / 1024))} KB` : ''
  return kb ? `${name} • ${kb}` : name
}

function guessMimeFromFileName(name) {
  const ext = String(name || '')
    .split('.')
    .pop()
    ?.toLowerCase()
  const map = {
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    html: 'text/html',
    htm: 'text/html',
    rtf: 'application/rtf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }
  return map[ext] || 'application/octet-stream'
}

export async function warmUpSearchModel(onStatus) {
  const mod = await import('./embedder')
  await mod.loadEmbedder({ onStatus })
}

export async function getAllMaterials() {
  return await getAll()
}

export async function clearAllMaterials() {
  await clearAll()
}

export async function deleteMaterial(materialId) {
  await remove(materialId)
}

export async function addMaterialsFromFiles(files, onProgress) {
  const list = Array.from(files || [])
  if (!list.length) return []

  const out = []
  for (let i = 0; i < list.length; i += 1) {
    const f = list[i]
    const label = `Reading ${f.name}…`
    onProgress?.({ label, progress: i / Math.max(1, list.length) })

    const buf = await f.arrayBuffer()
    const mime = f.type || guessMimeFromFileName(f.name)
    const fileForExtract = new File([buf], f.name, { type: mime })
    const text = await extractTextFromFile(fileForExtract)
    const clean = normalizeText(text)
    if (!clean) throw new Error(`No readable text found in ${f.name}`)

    const title = inferTitleFromName(f.name)
    const fileBlob = new Blob([buf], { type: mime })
    const material = await buildMaterial({
      type: 'file',
      title,
      sourceLabel: sourceLabelFromFile(f),
      text: clean,
      url: null,
      fileBlob,
      mimeType: mime,
      fileName: f.name,
      onProgress: (p) => {
        const base = i / Math.max(1, list.length)
        const step = 1 / Math.max(1, list.length)
        onProgress?.({
          label: p.label,
          progress: base + step * p.progress,
        })
      },
    })

    await put(material)
    out.push(material)
  }

  onProgress?.({ label: 'Done', progress: 1 })
  return out
}

export async function addMaterialFromLink(url, onProgress) {
  onProgress?.({ label: 'Fetching link…', progress: 0 })
  const text = await extractTextFromLink(url)
  const clean = normalizeText(text)
  if (!clean) throw new Error('No readable text found at that link')

  const title = guessTitleFromLink(url, clean)
  const material = await buildMaterial({
    type: 'link',
    title,
    sourceLabel: url,
    url,
    text: clean,
    onProgress,
  })

  await put(material)
  onProgress?.({ label: 'Done', progress: 1 })
  return material
}

function guessTitleFromLink(url, text) {
  const titleLine = String(text || '')
    .split('\n')
    .map((x) => x.trim())
    .find((l) => /^title\s*:/i.test(l))
  if (titleLine) {
    const t = titleLine.replace(/^title\s*:\s*/i, '').trim()
    if (t && t.length <= 110) return t
  }
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    const firstLine = String(text || '').split('\n').map((x) => x.trim()).find(Boolean)
    const pathBits = u.pathname
      .split('/')
      .filter(Boolean)
      .slice(-2)
      .join(' · ')
      .replace(/[-_]+/g, ' ')
      .trim()
    const fallback = pathBits ? `${host} · ${pathBits}` : host
    const title = firstLine && firstLine.length >= 12 && firstLine.length <= 90 ? firstLine : fallback
    return title || fallback || 'Saved link'
  } catch {
    const firstLine = String(text || '').split('\n').map((x) => x.trim()).find(Boolean)
    return firstLine && firstLine.length <= 90 ? firstLine : 'Saved link'
  }
}

async function buildMaterial({
  type,
  title,
  sourceLabel,
  text,
  url,
  fileBlob,
  mimeType,
  fileName,
  onProgress,
}) {
  const createdAt = Date.now()
  const chunks = chunkText(text, { targetChars: 1400, overlapChars: 300 })
  if (!chunks.length) throw new Error('Nothing to index')

  const chunkObjs = []
  for (let i = 0; i < chunks.length; i += 1) {
    const progress = i / Math.max(1, chunks.length)
    onProgress?.({ label: `Indexing: ${title}`, progress })
    const mod = await import('./embedder')
    const emb = await mod.embed(chunks[i])
    chunkObjs.push({
      id: id(),
      text: chunks[i],
      embedding: emb,
    })
  }

  const preview = text.slice(0, 260)
  const material = {
    id: id(),
    type,
    title,
    sourceLabel,
    url,
    createdAt,
    text,
    preview,
    chunks: chunkObjs,
  }
  if (type === 'file' && fileBlob) {
    material.fileBlob = fileBlob
    material.mimeType = mimeType || fileBlob.type || 'application/octet-stream'
    if (fileName) material.fileName = fileName
  }
  return material
}

function scoreChunkHit(qEmb, qTokens, x) {
  const sem = cosine(qEmb, x.chunk.embedding)
  const lex = lexicalScore(qTokens, x.chunk.text)
  const meta = `${x.material.title} ${x.material.sourceLabel} ${x.material.url || ''}`
  const metaLex = lexicalScore(qTokens, meta)

  // Strong boost when the material title/metadata matches the query keywords
  // This ensures project-specific questions pull from the correct file
  let exactBoost = 0
  if (qTokens.length) {
    const lowMeta = meta.toLowerCase()
    const hits = qTokens.reduce((acc, t) => acc + (lowMeta.includes(t) ? 1 : 0), 0)
    if (hits === qTokens.length) exactBoost += 0.25
    else if (hits >= Math.max(1, Math.ceil(qTokens.length / 2))) exactBoost += 0.15
    else if (hits) exactBoost += 0.06
  }

  return sem * 0.78 + lex * 0.22 + metaLex * 0.14 + exactBoost
}

/**
 * Rank all indexed chunks for a query (semantic + lexical). Used by library search and AI Q&A retrieval.
 */
export async function rankChunksForQuery(query, { limit = 30, minScore = null } = {}) {
  const q = normalizeText(query)
  if (!q) return { query: '', hits: [] }

  const all = await getAll()
  if (!all.length) return { query: q, hits: [] }

  const mod = await import('./embedder')
  const qEmb = await mod.embed(q)
  const qTokens = tokenize(q)

  const allChunks = []
  for (const m of all) {
    for (const c of m.chunks || []) {
      allChunks.push({ materialId: m.id, material: m, chunk: c })
    }
  }

  const scoreOf = (x) => scoreChunkHit(qEmb, qTokens, x)

  let hits = topK(allChunks, limit, scoreOf).map(({ it, s }) => ({
    materialId: it.materialId,
    material: it.material,
    chunkId: it.chunk.id,
    score: Math.max(0, Math.min(1, s)),
    text: it.chunk.text,
  }))

  if (minScore != null) hits = hits.filter((h) => h.score > minScore)

  return { query: q, hits }
}

export async function searchMaterials(query, { limit = 30 } = {}) {
  const { query: q, hits: ranked } = await rankChunksForQuery(query, { limit, minScore: null })
  if (!q) return { query: '', grouped: [], hits: [] }

  const hits = ranked
    .map((h) => ({
      ...h,
      snippet: snippetAround(h.text, q),
    }))
    .filter((h) => h.score > 0.20)

  const bestByMaterial = new Map()
  for (const h of hits) {
    const prev = bestByMaterial.get(h.materialId)
    if (!prev || h.score > prev.score) bestByMaterial.set(h.materialId, h)
  }

  const grouped = Array.from(bestByMaterial.entries())
    .map(([, best]) => ({ material: best.material, best }))
    .sort((a, b) => b.best.score - a.best.score)

  return { query: q, hits, grouped }
}

