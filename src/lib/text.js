let pdfReady = null
async function getPdf() {
  if (!pdfReady) {
    pdfReady = (async () => {
      const pdfjs = await import('pdfjs-dist')
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString()
      return pdfjs
    })()
  }
  return await pdfReady
}

let mammothReady = null
async function getMammoth() {
  if (!mammothReady) mammothReady = import('mammoth')
  const mod = await mammothReady
  return mod.default || mod
}

export async function extractTextFromFile(file) {
  const name = file?.name || 'Untitled'
  const type = (file?.type || '').toLowerCase()
  const ext = name.split('.').pop()?.toLowerCase() || ''

  if (type.includes('pdf') || ext === 'pdf') return await extractPdf(file)
  if (
    type.includes('word') ||
    ext === 'docx' ||
    ext === 'doc' ||
    type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return await extractDocx(file)
  }

  return await extractPlainText(file)
}

async function extractPlainText(file) {
  const raw = await file.text()
  return normalizeText(raw)
}

async function extractDocx(file) {
  const buf = await file.arrayBuffer()
  const mammoth = await getMammoth()
  const out = await mammoth.extractRawText({ arrayBuffer: buf })
  return normalizeText(out.value || '')
}

async function extractPdf(file) {
  const buf = await file.arrayBuffer()
  const pdfjs = await getPdf()
  const doc = await pdfjs.getDocument({ data: buf }).promise
  const pages = []

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
    const page = await doc.getPage(pageNum)
    const text = await page.getTextContent()
    const strings = (text.items || [])
      .map((it) => (typeof it.str === 'string' ? it.str : ''))
      .filter(Boolean)
    pages.push(strings.join(' '))
  }

  return normalizeText(pages.join('\n\n'))
}

export async function extractTextFromLink(url) {
  const clean = url.trim()
  if (!/^https?:\/\//i.test(clean)) {
    throw new Error('Link must start with http:// or https://')
  }

  const proxyUrl = `https://r.jina.ai/${clean}`
  const res = await fetch(proxyUrl, { method: 'GET' })
  if (!res.ok) throw new Error(`Could not fetch link (status ${res.status})`)
  const raw = await res.text()

  const trimmed = stripLikelyBoilerplate(raw)
  return normalizeText(trimmed.slice(0, 120_000))
}

function stripLikelyBoilerplate(text) {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  const nav = new Set([
    'home',
    'about',
    'contact',
    'privacy',
    'terms',
    'login',
    'sign in',
    'sign up',
    'subscribe',
    'search',
    'skip to content',
  ])

  const kept = []
  let last = null
  for (const line of lines) {
    const low = line.toLowerCase()
    if (line.length < 2) continue
    if (/^https?:\/\/\S+$/i.test(line)) continue
    if (low.startsWith('cookie')) continue
    if (low.includes('privacy policy')) continue
    if (nav.has(low)) continue
    if (/^[^a-z0-9]{0,6}$/i.test(line)) continue
    if (last && low === last) continue
    kept.push(line)
    last = low
  }
  return kept.join('\n')
}

export function normalizeText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export function chunkText(text, { targetChars = 900, overlapChars = 160 } = {}) {
  const clean = normalizeText(text)
  if (!clean) return []

  const parts = clean
    .split(/\n{2,}/g)
    .map((p) => p.trim())
    .filter(Boolean)

  const chunks = []
  let buf = ''

  function flush() {
    const s = buf.trim()
    if (s) chunks.push(s)
    buf = ''
  }

  for (const p of parts) {
    if (!buf) {
      buf = p
      continue
    }
    if (buf.length + 2 + p.length <= targetChars) {
      buf += `\n\n${p}`
    } else {
      flush()
      buf = p
    }
  }
  flush()

  if (overlapChars <= 0 || chunks.length <= 1) return chunks

  const overlapped = []
  for (let i = 0; i < chunks.length; i += 1) {
    const prev = i > 0 ? chunks[i - 1] : ''
    const take = prev ? prev.slice(Math.max(0, prev.length - overlapChars)) : ''
    const merged = take ? `${take}\n\n${chunks[i]}` : chunks[i]
    overlapped.push(merged)
  }
  return overlapped
}

