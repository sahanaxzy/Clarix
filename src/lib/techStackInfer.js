/**
 * Infer tech stack (e.g. MERN) by scanning full material text — not a single extractive QA span.
 * IMPORTANT: answers are scoped to the topic/project mentioned in the question.
 */

function mergeCorpusFromHits(hits, maxChars = 48_000) {
  const seen = new Set()
  const parts = []
  for (const h of hits) {
    const id = h.materialId
    if (!id || seen.has(id)) continue
    seen.add(id)
    const full = h.material?.text
    const chunk = String(h.text || '')
    const body = full && full.length > chunk.length ? full : chunk
    if (body.trim()) parts.push(body)
  }
  return parts.join('\n\n').slice(0, maxChars)
}

const STOP = new Set([
  'which','what','when','where','will','used','from','that','this','with',
  'tech','stack','techstack','technologies','technology','framework',
  'frameworks','being','about','have','does','the','for',
])

/** Extract the meaningful topic words from the question. */
function topicWordsFromQuestion(question) {
  const words = String(question || '')
    .toLowerCase()
    .match(/[a-z][a-z0-9_-]{2,}/g)
  if (!words?.length) return []
  return words.filter((w) => !STOP.has(w) && w.length >= 3)
}

function topicFromQuestion(question) {
  const words = topicWordsFromQuestion(question)
  const cand = [...words].reverse().find((w) => w.length >= 4)
  return cand || ''
}

/**
 * FILTER hits to only include materials that match the topic in the question.
 * This prevents answers from bleeding across different projects.
 * Falls back to all hits if no topic-specific materials are found.
 */
function filterHitsByTopic(question, hits) {
  const topicWords = topicWordsFromQuestion(question)
  if (!topicWords.length) return hits

  // Score each material by how many topic words appear in its title + text
  const scored = hits.map((h) => {
    const blob = `${h.material?.title || ''} ${h.material?.fileName || ''}`.toLowerCase()
    const fullBlob = `${blob} ${String(h.material?.text || '').toLowerCase().slice(0, 3000)}`
    let titleHits = 0
    let textHits = 0
    for (const w of topicWords) {
      if (blob.includes(w)) titleHits += 1
      if (fullBlob.includes(w)) textHits += 1
    }
    return { hit: h, titleHits, textHits }
  })

  // Filter to materials that match at least one topic word in title
  const titleMatched = scored.filter((s) => s.titleHits > 0)
  if (titleMatched.length > 0) {
    titleMatched.sort((a, b) => b.titleHits - a.titleHits)
    return titleMatched.map((s) => s.hit)
  }

  // Fall back to materials that match in text
  const textMatched = scored.filter((s) => s.textHits > 0)
  if (textMatched.length > 0) {
    textMatched.sort((a, b) => b.textHits - a.textHits)
    return textMatched.map((s) => s.hit)
  }

  return hits
}

function detectMernPieces(corpus) {
  const t = String(corpus || '')
  const mongo =
    /\b(mongodb|mongoose)\b/i.test(t) ||
    /\bmongo\s*db\b/i.test(t) ||
    /\bmongodb\s*\+/i.test(t) ||
    /\bmongo\s*:\s*\/\//i.test(t)
  const express =
    /(?:^|[^a-z])express(?:\.js)?\b/i.test(t) && !/\bexpression\b/i.test(t.slice(0, Math.min(t.length, 8000)))
  const react = /(?:^|[^a-z])react(?:\.js)?\b/i.test(t)
  const node =
    /\bnode\.js\b|\bnodejs\b/i.test(t) ||
    (/\bnode\b/i.test(t) && /\b(server|backend|api|runtime|express)\b/i.test(t))

  return { mongo, express, react, node, mernWord: /\bmern\b/i.test(t) }
}

function otherTechLabels(corpus) {
  const t = String(corpus || '')
  const out = []
  const push = (label, re) => {
    if (re.test(t) && !out.includes(label)) out.push(label)
  }
  push('TypeScript', /\btypescript\b/i)
  push('Tailwind CSS', /\btailwind\b/i)
  push('Vite', /\bvite\b/i)
  push('Docker', /\bdocker\b/i)
  push('PostgreSQL', /\bpostgres(ql)?\b/i)
  push('Redis', /\bredis\b/i)
  push('Next.js', /\bnext\.?js\b/i)
  push('Python', /\bpython\b/i)
  push('Django', /\bdjango\b/i)
  push('Flask', /\bflask\b/i)
  push('FastAPI', /\bfastapi\b/i)
  push('Flutter', /\bflutter\b/i)
  push('Dart', /\bdart\b/i)
  push('Java', /\bjava\b(?!\s*script)/i)
  push('Kotlin', /\bkotlin\b/i)
  push('Swift', /\bswift\b/i)
  push('Go', /\bgolang\b/i)
  push('Rust', /\brust\b/i)
  push('C++', /\bc\+\+\b/i)
  push('PHP', /\bphp\b/i)
  push('Laravel', /\blaravel\b/i)
  push('Ruby on Rails', /\brails\b/i)
  push('Firebase', /\bfirebase\b/i)
  push('Supabase', /\bsupabase\b/i)
  push('MySQL', /\bmysql\b/i)
  push('SQLite', /\bsqlite\b/i)
  push('GraphQL', /\bgraphql\b/i)
  push('KML', /\bkml\b/i)
  push('Google Earth', /\bgoogle\s*earth\b/i)
  push('Cesium', /\bcesium\b/i)
  push('Three.js', /\bthree\.?js\b/i)
  push('Leaflet', /\bleaflet\b/i)
  push('Mapbox', /\bmapbox\b/i)
  push('OpenLayers', /\bopenlayers\b/i)
  push('Earth Engine', /\bearth\s*engine\b/i)
  push('Liquid Galaxy', /\bliquid\s*galaxy\b/i)
  push('WebSocket', /\bwebsocket\b/i)
  push('Socket.IO', /\bsocket\.io\b/i)
  push('AWS', /\baws\b/i)
  push('GCP', /\bgcp\b/i)
  push('Azure', /\bazure\b/i)
  return out.slice(0, 12)
}

/**
 * @returns {{ answer: string, materialId: string | null, title: string, confidence: string } | null}
 */
export function inferStackFromCorpus(question, hits) {
  if (!hits?.length) return null

  // CRITICAL: Filter hits to only topic-relevant materials
  const filtered = filterHitsByTopic(question, hits)
  const corpus = mergeCorpusFromHits(filtered)
  if (corpus.length < 80) return null

  const m = detectMernPieces(corpus)
  const parts = []
  if (m.mongo) parts.push('MongoDB')
  if (m.express) parts.push('Express.js')
  if (m.react) parts.push('React')
  if (m.node) parts.push('Node.js')
  const n = [m.mongo, m.express, m.react, m.node].filter(Boolean).length

  const top = filtered[0]
  const materialId = top?.materialId ?? null
  const title = top?.material?.title || 'Untitled'

  const suffix = ' (inferred from your materials)'

  // Also detect non-MERN technologies
  const extra = otherTechLabels(corpus)

  if (m.mernWord || n === 4) {
    const also = extra.filter((e) => !['MongoDB','Express.js','React','Node.js'].includes(e))
    const tail = also.length ? ` Also uses: ${also.join(', ')}.` : ''
    return {
      answer: `MongoDB, Express.js, React, Node.js — MERN stack.${tail}${suffix}`,
      materialId,
      title,
      confidence: 'high',
    }
  }

  if (n === 3) {
    const missing = !m.mongo ? 'MongoDB' : !m.express ? 'Express' : !m.react ? 'React' : 'Node.js'
    const tail = extra.length ? ` Also: ${extra.filter((e) => !parts.includes(e)).join(', ')}.` : ''
    return {
      answer: `${parts.join(', ')} — likely MERN-related; ${missing} not clearly named in your indexed text.${tail}${suffix}`,
      materialId,
      title,
      confidence: 'medium',
    }
  }

  // If we found other (non-MERN) technologies, report those instead of claiming MERN
  if (extra.length >= 1) {
    const hasMernParts = n > 0
    const mernNote = hasMernParts ? ` Also found: ${parts.join(', ')}.` : ''
    return {
      answer: `Technologies found: ${extra.join(', ')}.${mernNote}${suffix}`,
      materialId,
      title,
      confidence: extra.length >= 3 ? 'medium' : 'low',
    }
  }

  if (n === 2) {
    return {
      answer: `${parts.join(' and ')} found; no other clear tech stack identified.${suffix}`,
      materialId,
      title,
      confidence: 'low',
    }
  }

  if (n === 1) {
    return {
      answer: `Only ${parts[0]} clearly identified. Check your files for more details.${suffix}`,
      materialId,
      title,
      confidence: 'low',
    }
  }

  return null
}

export function isTechStackQuestion(q) {
  return /tech\s*stack|techstack|technologies|technology|frameworks?|languages?\s+used|libraries|built\s+with|what\s+.*\s+(use|using|built|powered)|which\s+.*\s+(use|using)|\bstack\b|frontend|backend|database/i.test(
    String(q || ''),
  )
}
