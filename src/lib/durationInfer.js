/**
 * Infer project / OJT duration in days from full material text — not a single extractive QA span.
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

function durationAnchors(question) {
  const q = String(question || '').toLowerCase()
  const anchors = []
  if (/\bojt\b/i.test(q)) anchors.push('ojt')
  if (/\blogbook\b/i.test(q)) anchors.push('logbook')
  if (/\binternship\b/i.test(q)) anchors.push('internship')
  if (/\bplacement\b/i.test(q)) anchors.push('placement')
  if (/\btraining\b/i.test(q)) anchors.push('training')
  if (/\bproject\b/i.test(q)) anchors.push('project')
  return anchors
}

/** Extract topic words from the question (e.g., "skillswap", "bird migration"). */
function topicWordsFromQuestion(question) {
  const stop = new Set(['how','many','days','was','the','ojt','project','internship',
    'training','placement','logbook','long','duration','what','number','of','for','did','take'])
  const words = String(question || '')
    .toLowerCase()
    .match(/[a-z][a-z0-9_-]{2,}/g)
  if (!words?.length) return []
  return words.filter((w) => !stop.has(w) && w.length >= 3)
}

/** FILTER hits to only materials matching the topic + anchors. Falls back to all if none match. */
function filterHitsForDuration(question, hits) {
  const anchors = durationAnchors(question)
  const topicWords = topicWordsFromQuestion(question)

  const score = (h) => {
    const title = (h.material?.title || '').toLowerCase()
    const fileName = (h.material?.fileName || '').toLowerCase()
    const text = String(h.material?.text || h.text || '').toLowerCase().slice(0, 5000)
    const blob = `${title} ${fileName} ${text}`
    let s = 0
    // Topic words in title get high priority
    for (const w of topicWords) {
      if (title.includes(w) || fileName.includes(w)) s += 10
      else if (text.includes(w)) s += 2
    }
    // Anchors (ojt, internship, etc.)
    for (const a of anchors) {
      if (blob.includes(a)) s += 3
    }
    return s
  }

  const scored = hits.map((h) => ({ hit: h, score: score(h) }))
  // Filter to materials that match at least something
  const matched = scored.filter((s) => s.score > 0)
  if (matched.length > 0) {
    matched.sort((a, b) => b.score - a.score)
    return matched.map((s) => s.hit)
  }
  // Fall back to all hits sorted by score
  scored.sort((a, b) => b.score - a.score)
  return scored.map((s) => s.hit)
}

function normalizeCorpus(s) {
  return String(s || '')
    .replace(/\u2013|\u2014/g, '-') // en/em dash → hyphen (avoid "25 – 29" noise as range)
    .replace(/\s+/g, ' ')
}

function scoreWindow(win) {
  const before = win.before.toLowerCase()
  const after = win.after.toLowerCase()
  const blob = `${before} ${after}`
  let sc = 0

  const boost = (re, w) => {
    if (re.test(before) || re.test(after) || re.test(blob)) sc += w
  }

  boost(/\bojt\b/, 38)
  boost(/\blogbook\b/, 28)
  boost(/\binternship\b/, 26)
  boost(/\bplacement\b/, 18)
  boost(/\btraining\b/, 16)
  boost(/\bproject\b/, 14)
  boost(/\bduration\b/, 26)
  boost(/\bperiod\b/, 12)
  boost(/\btotal\b/, 22)
  boost(/\boverall\b/, 16)
  boost(/\bentire\b/, 12)
  boost(/\bactual\b/, 10)
  boost(/\bcompleted\b/, 14)
  boost(/\bspan(ned|s)?\b/, 14)
  boost(/\blasted\b/, 14)
  boost(/\btook\b/, 8)
  boost(/\bfor\b.*\bday/, 6)
  boost(/\bcalendar\b/, 8)
  boost(/\bworking\b/, 6)

  const penal = (re, w) => {
    if (re.test(before.slice(-80)) || re.test(after.slice(0, 80))) sc -= w
  }

  penal(/\bpage\s+\d/i, 35)
  penal(/\bpages\s+\d/i, 35)
  penal(/\bfig(?:ure)?\.?\s*\d/i, 25)
  penal(/\btable\s+\d/i, 20)
  penal(/\bweek\s+\d/i, 15)
  penal(/\bgrade\b/, 12)
  penal(/\bmarks?\b/, 10)

  const n = win.n
  if (n >= 1 && n <= 6) sc -= 18
  if (n > 400) sc -= 12
  if (n >= 14 && n <= 120) sc += 4

  return sc
}

function collectDayMentions(corpus) {
  const text = normalizeCorpus(corpus)
  const re = /\b(\d{1,4})\s*(?:calendar\s+|working\s+)?days?\b/gi
  const out = []
  let m
  while ((m = re.exec(text)) !== null) {
    const n = parseInt(m[1], 10)
    if (!Number.isFinite(n) || n < 1) continue
    const start = m.index
    const end = start + m[0].length
    const before = text.slice(Math.max(0, start - 140), start)
    const after = text.slice(end, Math.min(text.length, end + 100))
    out.push({ n, before, after, score: scoreWindow({ n, before, after }) })
  }
  return out
}

function parseDateParts(d, mo, yRaw) {
  const dNum = parseInt(d, 10)
  const mNum = parseInt(mo, 10)
  let y = parseInt(yRaw, 10)
  if (!Number.isFinite(dNum) || !Number.isFinite(mNum) || !Number.isFinite(y)) return null
  if (y < 100) y += 2000
  if (mNum < 1 || mNum > 12 || dNum < 1 || dNum > 31) return null
  const dt = new Date(y, mNum - 1, dNum)
  if (dt.getFullYear() !== y || dt.getMonth() !== mNum - 1 || dt.getDate() !== dNum) return null
  return dt
}

/** Inclusive calendar days between two dates (common for "internship from A to B"). */
function inclusiveDaySpan(start, end) {
  const ms = end.getTime() - start.getTime()
  if (ms < 0) return null
  return Math.floor(ms / 86400000) + 1
}

function tryDateRangeDays(corpus) {
  const text = normalizeCorpus(corpus)
  const patterns = [
    /\bfrom\s+(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\s+to\s+(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/gi,
    /\bfrom\s+(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\s+until\s+(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/gi,
    /\bbetween\s+(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\s+and\s+(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/gi,
  ]

  for (const re of patterns) {
    let m
    while ((m = re.exec(text)) !== null) {
      const a = parseDateParts(m[1], m[2], m[3])
      const b = parseDateParts(m[4], m[5], m[6])
      if (!a || !b) continue
      const days = inclusiveDaySpan(a, b)
      if (days == null || days < 2 || days > 800) continue
      const ctxStart = Math.max(0, m.index - 80)
      const ctx = text.slice(ctxStart, m.index + m[0].length + 40).toLowerCase()
      let sc = 6
      if (/\bojt\b/.test(ctx)) sc += 20
      if (/\blogbook\b/.test(ctx)) sc += 16
      if (/\binternship\b/.test(ctx)) sc += 14
      if (/\bproject\b/.test(ctx)) sc += 8
      if (/\btraining\b/.test(ctx)) sc += 8
      return { days, score: sc, snippet: m[0] }
    }
  }
  return null
}

function strongPhraseHits(corpus) {
  const text = normalizeCorpus(corpus)
  const lineRes = [
    /\b(?:total|overall|net|actual|entire)\s+(?:duration|period|length|time)\s*(?:of|was|is|:)?\s*(\d{1,4})\s*(?:calendar\s+|working\s+)?days?\b/gi,
    /\b(?:duration|period)\s*(?:of|was|is)\s*(?:the\s+)?(?:ojt|internship|project|training)[^.!?]{0,90}?(\d{1,4})\s*(?:calendar\s+|working\s+)?days?\b/gi,
    /\b(?:ojt|internship|project|training)[^.!?]{0,100}?(?:duration|period|completed|lasted|spanned|ran|for)\s*(?:over\s+)?[^.!?]{0,50}?(\d{1,4})\s*(?:calendar\s+|working\s+)?days?\b/gi,
    /\b(\d{1,4})\s*(?:calendar\s+|working\s+)?days?\s*(?:of|for)\s+(?:the\s+)?(?:ojt|internship|training|project|placement)\b/gi,
  ]
  const nums = []
  for (const re of lineRes) {
    let m
    while ((m = re.exec(text)) !== null) {
      const n = parseInt(m[1], 10)
      if (Number.isFinite(n) && n >= 1 && n <= 2000) nums.push(n)
    }
  }
  return nums
}

function pickMaterialForNumber(orderedHits, n) {
  const re = new RegExp(`\\b${n}\\s*(?:calendar\\s+|working\\s+)?days?\\b`, 'i')
  for (const h of orderedHits) {
    const body = String(h.material?.text || h.text || '')
    if (re.test(body)) return h
  }
  return orderedHits[0] || null
}

const SUFFIX = ' (from your materials)'

function aggregateDayScore(d) {
  return d.best + Math.min(d.count, 5) * 3 + Math.min(9, Math.max(0, d.sum - d.best))
}

/**
 * @returns {{ answer: string, materialId: string | null, title: string, confidence: 'high'|'medium'|'low' } | null}
 */
export function inferDurationDaysFromCorpus(question, hits) {
  if (!hits?.length) return null

  const ordered = filterHitsForDuration(question, hits)
  const corpus = mergeCorpusFromHits(ordered)
  if (corpus.length < 40) return null

  const strong = strongPhraseHits(corpus)
  if (strong.length) {
    const uniq = [...new Set(strong)]
    if (uniq.length === 1) {
      const n = uniq[0]
      const h = pickMaterialForNumber(ordered, n)
      return {
        answer: `${n} days${SUFFIX}`,
        materialId: h?.materialId ?? null,
        title: h?.material?.title || 'Untitled',
        confidence: 'high',
      }
    }
    const sorted = uniq.sort((a, b) => strong.filter((x) => x === b).length - strong.filter((x) => x === a).length)
    const best = sorted[0]
    const h = pickMaterialForNumber(ordered, best)
    return {
      answer: `${best} days${SUFFIX}`,
      materialId: h?.materialId ?? null,
      title: h?.material?.title || 'Untitled',
      confidence: 'medium',
    }
  }

  const mentions = collectDayMentions(corpus)
  if (!mentions.length) {
    const range = tryDateRangeDays(corpus)
    if (range && range.score >= 12) {
      const h = ordered[0]
      return {
        answer: `${range.days} days (from date range in your text)${SUFFIX}`,
        materialId: h?.materialId ?? null,
        title: h?.material?.title || 'Untitled',
        confidence: range.score >= 22 ? 'high' : 'medium',
      }
    }
    return null
  }

  const byN = new Map()
  for (const row of mentions) {
    const prev = byN.get(row.n) || { best: -1e9, count: 0, sum: 0 }
    byN.set(row.n, {
      best: Math.max(prev.best, row.score),
      count: prev.count + 1,
      sum: prev.sum + row.score,
    })
  }

  let bestN = null
  let bestSc = -1e9
  for (const [n, data] of byN) {
    const sc = aggregateDayScore(data)
    if (sc > bestSc) {
      bestSc = sc
      bestN = n
    }
  }

  const sorted = [...byN.entries()].sort((a, b) => aggregateDayScore(b[1]) - aggregateDayScore(a[1]))
  const second = sorted[1]

  const range = tryDateRangeDays(corpus)
  if (range && range.days === bestN && range.score >= 10) {
    const h = pickMaterialForNumber(ordered, bestN)
    return {
      answer: `${bestN} days${SUFFIX}`,
      materialId: h?.materialId ?? null,
      title: h?.material?.title || 'Untitled',
      confidence: 'high',
    }
  }

  if (bestN != null && bestSc >= 18) {
    if (second && aggregateDayScore(second[1]) >= bestSc - 4 && second[0] !== bestN) {
      return {
        answer: `Multiple day counts appear (${bestN} vs ${second[0]}). Open your OJT / logbook file and search "days" for the exact total.`,
        materialId: ordered[0]?.materialId ?? null,
        title: ordered[0]?.material?.title || 'Untitled',
        confidence: 'low',
      }
    }
    const h = pickMaterialForNumber(ordered, bestN)
    return {
      answer: `${bestN} days${SUFFIX}`,
      materialId: h?.materialId ?? null,
      title: h?.material?.title || 'Untitled',
      confidence: bestSc >= 28 ? 'high' : 'medium',
    }
  }

  if (range && range.score >= 8) {
    const h = ordered[0]
    return {
      answer: `${range.days} days (from date range in your text)${SUFFIX}`,
      materialId: h?.materialId ?? null,
      title: h?.material?.title || 'Untitled',
      confidence: 'medium',
    }
  }

  if (byN.size === 1 && bestN != null && bestSc >= 10) {
    const h = pickMaterialForNumber(ordered, bestN)
    return {
      answer: `${bestN} days${SUFFIX}`,
      materialId: h?.materialId ?? null,
      title: h?.material?.title || 'Untitled',
      confidence: 'medium',
    }
  }

  return null
}

export function isDurationDaysQuestion(q) {
  const s = String(q || '').toLowerCase()
  if (/\bhow\s+many\s+days\b/.test(s)) return true
  if (/\bnumber\s+of\s+days\b/.test(s)) return true
  if (/\bhow\s+long\b/.test(s) && /\bday/.test(s)) return true
  if (/\bduration\b/.test(s) && /\bday/.test(s)) return true
  if (/\btook\b/.test(s) && /\bday/.test(s)) return true
  if (/\blasted\b/.test(s) && /\bday/.test(s)) return true
  if (/\bhow\s+many\b/.test(s) && /\bday/.test(s)) return true
  // Broader: questions about duration/length of OJT/internship/project (even without "day")
  if (/\bhow\s+long\b/.test(s) && /\b(ojt|internship|project|training|placement)\b/.test(s)) return true
  if (/\bduration\b/.test(s) && /\b(ojt|internship|project|training|placement)\b/.test(s)) return true
  if (/\bhow\s+many\b/.test(s) && /\b(ojt|internship|project|training|placement)\b/.test(s)) return true
  return false
}
