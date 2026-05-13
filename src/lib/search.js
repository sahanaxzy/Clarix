export function cosine(a, b) {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let aa = 0
  let bb = 0
  for (let i = 0; i < n; i += 1) {
    const x = a[i]
    const y = b[i]
    dot += x * y
    aa += x * x
    bb += y * y
  }
  const denom = Math.sqrt(aa) * Math.sqrt(bb)
  return denom ? dot / denom : 0
}

const STOP = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'how',
  'i',
  'in',
  'into',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'our',
  'please',
  'show',
  'that',
  'the',
  'their',
  'this',
  'to',
  'tutorial',
  'want',
  'what',
  'where',
  'with',
  'you',
  'your',
])

export function tokenize(text) {
  const raw = String(text || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

  if (!raw) return []
  const tokens = raw
    .split(/\s+/g)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length >= 3)
    .filter((t) => !STOP.has(t))

  return Array.from(new Set(tokens)).slice(0, 24)
}

export function lexicalScore(queryTokens, text) {
  const q = queryTokens || []
  if (!q.length) return 0
  const t = String(text || '').toLowerCase()
  if (!t) return 0

  let hit = 0
  for (const tok of q) {
    if (t.includes(tok)) hit += 1
  }
  return hit / q.length
}

export function topK(items, k, scoreOf) {
  const out = []
  for (const it of items) {
    const s = scoreOf(it)
    if (out.length < k) {
      out.push({ it, s })
      out.sort((a, b) => b.s - a.s)
      continue
    }
    if (s <= out[out.length - 1].s) continue
    out[out.length - 1] = { it, s }
    out.sort((a, b) => b.s - a.s)
  }
  return out
}

export function snippetAround(text, query, maxLen = 220) {
  const t = String(text || '')
  const q = String(query || '').trim()
  if (!t) return ''
  if (!q) return t.slice(0, maxLen)

  const needle = q
    .split(/\s+/g)
    .slice(0, 6)
    .filter(Boolean)
    .join(' ')
    .trim()

  const idx = t.toLowerCase().indexOf(needle.toLowerCase())
  if (idx === -1) return t.slice(0, maxLen)

  const start = Math.max(0, idx - Math.floor(maxLen * 0.35))
  const end = Math.min(t.length, start + maxLen)
  const slice = t.slice(start, end).trim()
  return (start > 0 ? '… ' : '') + slice + (end < t.length ? ' …' : '')
}

