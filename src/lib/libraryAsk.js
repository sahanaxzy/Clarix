import { normalizeText } from './text'
import { rankChunksForQuery } from './materials'

const MAX_CONTEXT_CHARS = 28_000

/* ─── Source helpers ─── */

function uniqueSourcesFromHits(hits) {
  const byId = new Map()
  for (const h of hits) {
    const m = h.material
    if (!m?.id || byId.has(m.id)) continue
    byId.set(m.id, {
      materialId: m.id,
      title: m.title || 'Untitled',
      type: m.type,
      sourceLabel: m.sourceLabel || '',
      url: m.url || null,
    })
  }
  return Array.from(byId.values())
}

function labelForSource(s, index) {
  const kind = s.type === 'link' ? 'link' : 'file'
  return `[${index + 1}] ${s.title} (${kind})`
}

function buildContextBlocks(hits, sources) {
  const idToIndex = new Map(sources.map((s, i) => [s.materialId, i]))
  const lines = []
  let total = 0
  for (const h of hits) {
    const idx = idToIndex.get(h.materialId)
    if (idx === undefined) continue
    const head = labelForSource(sources[idx], idx)
    const body = String(h.text || '').trim()
    if (!body) continue
    const block = `${head}\n${body}`
    if (total + block.length > MAX_CONTEXT_CHARS) break
    lines.push(block)
    total += block.length + 2
  }
  return lines.join('\n\n---\n\n')
}

function orderSourcesFirst(sources, materialId) {
  if (!materialId || !sources?.length) return sources
  const i = sources.findIndex((s) => s.materialId === materialId)
  if (i <= 0) return sources
  const next = [...sources]
  const [head] = next.splice(i, 1)
  return [head, ...next]
}

function truncateBrief(text, max = 600) {
  const t = String(text || '').trim().replace(/\n{3,}/g, '\n\n')
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const last = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'))
  return `${last > max * 0.4 ? cut.slice(0, last + 1) : cut}…`.trim()
}

/* ─── API key helpers ─── */

function pickGeminiKey() {
  const v = import.meta.env.VITE_GEMINI_API_KEY
  return v && String(v).trim() ? String(v).trim() : ''
}

function pickOpenAiKey() {
  const v = import.meta.env.VITE_OPENAI_API_KEY
  return v && String(v).trim() ? String(v).trim() : ''
}

/* ─── Cloud model calls ─── */

async function callGeminiWithModel(system, user, apiKey, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 600 },
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText || 'Gemini request failed'
    throw new Error(msg)
  }
  const text =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join(' ') || ''
  if (!text.trim()) throw new Error('Empty response from Gemini')
  return text.trim()
}

async function callGemini(system, user, apiKey, preferredModel) {
  // Try multiple models in order — free tier quotas vary by model
  const models = [
    preferredModel,
    'gemini-2.0-flash-lite',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
  ].filter(Boolean)
  // Deduplicate
  const unique = [...new Set(models)]

  let lastError = null
  for (const m of unique) {
    try {
      return await callGeminiWithModel(system, user, apiKey, m)
    } catch (e) {
      lastError = e
      // If it's a quota error, try the next model
      if (/quota|rate.limit|resource.exhausted/i.test(e?.message || '')) continue
      // For other errors, throw immediately
      throw e
    }
  }
  throw lastError || new Error('All Gemini models failed')
}

async function callOpenAICompatible(system, user, apiKey, baseUrl, model) {
  const base = (baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')
  const url = `${base}/chat/completions`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 600,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText || 'OpenAI-compatible request failed'
    throw new Error(msg)
  }
  const text = data?.choices?.[0]?.message?.content
  if (!text || !String(text).trim()) throw new Error('Empty response from model')
  return String(text).trim()
}

const CLOUD_SYSTEM = `You are an AI assistant that answers questions ONLY using the provided CONTEXT from the user's uploaded files.

Rules:
- Answer the question directly and accurately using ONLY information from the CONTEXT.
- If the CONTEXT contains multiple files/sources, identify which one is most relevant to the question and answer from that.
- Be specific: include names, numbers, dates, and details from the CONTEXT.
- If the answer is NOT in the CONTEXT at all, reply: "This information is not in your uploaded materials."
- Keep your answer concise (2-5 sentences).
- Do NOT make up information that isn't in the CONTEXT.
- Do NOT use phrases like "based on the context" or "according to the document" — just give the answer directly.`

/* ─── Smart passage retrieval (on-device, no API key) ─── */

/**
 * Extract meaningful keywords from the question, removing stop words.
 */
function extractKeywords(question) {
  const stop = new Set([
    'a','an','and','are','as','at','be','been','but','by','can','could','did','do','does',
    'for','from','had','has','have','he','her','him','his','how','i','if','in','into','is',
    'it','its','just','let','may','me','might','my','no','not','of','on','or','our','own',
    'please','say','she','should','so','some','than','that','the','their','them','then',
    'there','these','they','this','to','too','us','very','want','was','we','were','what',
    'when','where','which','while','who','whom','why','will','with','would','you','your',
    'tell','find','give','show','many','much','long',
  ])
  return String(question || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !stop.has(w))
}

/**
 * Score a sentence by how many question keywords it contains.
 */
function scoreSentence(sentence, keywords) {
  const lower = sentence.toLowerCase()
  let hits = 0
  for (const kw of keywords) {
    if (lower.includes(kw)) hits += 1
  }
  return keywords.length > 0 ? hits / keywords.length : 0
}

/**
 * From the retrieved hits, find the best matching passages by analyzing
 * the FULL TEXT of each material (not just chunks).
 * Prioritizes materials whose title/filename matches the question topic.
 */
function findBestPassages(question, hits, maxPassages = 4) {
  const keywords = extractKeywords(question)
  if (!keywords.length || !hits.length) return null

  // Deduplicate by material and get full texts
  const materialTexts = new Map()
  for (const h of hits) {
    if (materialTexts.has(h.materialId)) continue
    const fullText = h.material?.text || h.text || ''
    const title = h.material?.title || 'Untitled'
    materialTexts.set(h.materialId, { fullText, title, materialId: h.materialId })
  }

  // Score each material by title relevance
  const scoredMaterials = []
  for (const [, mat] of materialTexts) {
    const titleLower = mat.title.toLowerCase()
    let titleScore = 0
    for (const kw of keywords) {
      if (titleLower.includes(kw)) titleScore += 1
    }
    scoredMaterials.push({ ...mat, titleScore })
  }
  // Sort: title-matching materials first
  scoredMaterials.sort((a, b) => b.titleScore - a.titleScore)

  // From each material, extract the most relevant sentences
  const allSentences = []
  for (const mat of scoredMaterials.slice(0, 4)) {
    const sentences = mat.fullText
      .split(/(?<=[.!?\n])\s+/)
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter((s) => s.length >= 10 && s.length <= 500)

    for (const s of sentences) {
      const rel = scoreSentence(s, keywords)
      if (rel >= 0.2) {
        allSentences.push({
          text: s,
          relevance: rel + (mat.titleScore > 0 ? 0.3 : 0), // boost title-matched materials
          materialId: mat.materialId,
          title: mat.title,
        })
      }
    }
  }

  if (!allSentences.length) return null

  // Sort by relevance, deduplicate
  allSentences.sort((a, b) => b.relevance - a.relevance)
  const seen = new Set()
  const unique = []
  for (const s of allSentences) {
    const key = s.text.toLowerCase().slice(0, 40)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(s)
    if (unique.length >= maxPassages) break
  }

  return unique
}

/**
 * Build an on-device answer from the best matching passages.
 */
function buildPassageAnswer(passages, sources) {
  if (!passages?.length) return null

  // Combine top passages into an answer
  const topPassages = passages.slice(0, 3)
  const answer = topPassages.map((p) => p.text).join('\n\n')
  const materialId = topPassages[0].materialId

  return {
    answer: truncateBrief(answer, 600),
    sources: orderSourcesFirst(sources, materialId),
    mode: 'local',
  }
}

/* ─── Main entry point ─── */

/**
 * @param {string} question
 * @param {{ onStatus?: (s: { label: string }) => void }} [opts]
 */
export async function askLibrary(question, { onStatus } = {}) {
  const q = normalizeText(question)
  if (!q) return { answer: '', sources: [], mode: 'empty' }

  // ── Step 1: Retrieve relevant passages ──
  onStatus?.({ label: 'Finding relevant passages in your library…' })
  const { hits: ranked } = await rankChunksForQuery(q, {
    limit: 40,
    minScore: 0.05,
  })

  if (!ranked.length) {
    return {
      answer: 'Nothing in your materials matched this question. Try adding a file that covers this topic, or rephrase your question.',
      sources: [],
      mode: 'no_match',
    }
  }

  const sources = uniqueSourcesFromHits(ranked)
  const context = buildContextBlocks(ranked, sources)

  if (!context.trim()) {
    return {
      answer: 'The matches were too weak to answer. Try rephrasing your question.',
      sources,
      mode: 'weak',
    }
  }

  const userPayload = `QUESTION:\n${q}\n\nCONTEXT:\n\n${context}`

  // ── Step 2: Try cloud model (Gemini or OpenAI) ──
  const geminiKey = pickGeminiKey()
  const openaiKey = pickOpenAiKey()

  if (geminiKey) {
    onStatus?.({ label: 'Asking Gemini…' })
    try {
      const model = import.meta.env.VITE_GEMINI_MODEL
      const raw = await callGemini(CLOUD_SYSTEM, userPayload, geminiKey, model)
      return { answer: truncateBrief(raw), sources, mode: 'gemini' }
    } catch (e) {
      console.error('Gemini failed:', e)
      // Show the error to the user instead of silently falling back
      return {
        answer: `Gemini API error: ${e?.message || 'Unknown error'}. Check your API key in .env or try again.`,
        sources,
        mode: 'gemini',
      }
    }
  }

  if (openaiKey) {
    onStatus?.({ label: 'Asking cloud model…' })
    try {
      const base = import.meta.env.VITE_OPENAI_BASE_URL
      const model = import.meta.env.VITE_OPENAI_MODEL
      const raw = await callOpenAICompatible(CLOUD_SYSTEM, userPayload, openaiKey, base, model)
      return { answer: truncateBrief(raw), sources, mode: 'openai' }
    } catch (e) {
      console.error('OpenAI failed:', e)
      onStatus?.({ label: 'Cloud failed — finding relevant passages…' })
    }
  }

  // ── Step 3: On-device fallback — smart passage retrieval ──
  onStatus?.({ label: 'Finding the best matching text in your files…' })

  const passages = findBestPassages(q, ranked)
  if (passages?.length) {
    const result = buildPassageAnswer(passages, sources)
    if (result) return result
  }

  // Last resort: show the top chunk text directly
  const topHit = ranked[0]
  const snippet = String(topHit.text || '').replace(/\s+/g, ' ').trim().slice(0, 400)
  return {
    answer: snippet || 'Could not find a clear answer. Try opening the source file directly.',
    sources: orderSourcesFirst(sources, topHit.materialId),
    mode: 'local',
  }
}
