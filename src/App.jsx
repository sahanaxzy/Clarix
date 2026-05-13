import { useEffect, useMemo, useRef, useState } from 'react'
import { Toaster, toast } from 'react-hot-toast'
import { AnimatePresence, motion } from 'framer-motion'
import { askLibrary } from './lib/libraryAsk'
import {
  addMaterialsFromFiles,
  addMaterialFromLink,
  clearAllMaterials,
  deleteMaterial,
  getAllMaterials,
  searchMaterials,
  warmUpSearchModel,
} from './lib/materials'

function App() {
  const [materials, setMaterials] = useState([])
  const [query, setQuery] = useState('')
  const [activeType, setActiveType] = useState('all')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)
  const [results, setResults] = useState(null)
  const [linkUrl, setLinkUrl] = useState('')
  const [askText, setAskText] = useState('')
  const [askLoading, setAskLoading] = useState(false)
  const [askStatus, setAskStatus] = useState('')
  const [askResult, setAskResult] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const all = await getAllMaterials()
        if (!alive) return
        setMaterials(all)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const visible = useMemo(() => {
    const base = results?.grouped ?? materials.map((m) => ({ material: m, best: null }))
    if (activeType === 'all') return base
    return base.filter((x) => x.material.type === activeType)
  }, [materials, results, activeType])

  async function refresh() {
    const all = await getAllMaterials()
    setMaterials(all)
  }

  async function onPickFiles(files) {
    const list = Array.from(files || [])
    if (!list.length) return

    setBusy({ kind: 'indexing', label: 'Indexing materials…', progress: 0 })
    try {
      await warmUpSearchModel((p) => setBusy((b) => (b ? { ...b, label: p.label } : b)))
      await addMaterialsFromFiles(list, (p) =>
        setBusy((b) => (b ? { ...b, label: p.label, progress: p.progress } : b)),
      )
      await refresh()
      toast.success('Added to your library')
    } catch (e) {
      toast.error(e?.message || 'Could not add those files')
    } finally {
      setBusy(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function onAddLink() {
    const url = linkUrl.trim()
    if (!url) return

    setBusy({ kind: 'indexing', label: 'Fetching link…', progress: 0 })
    try {
      await warmUpSearchModel((p) => setBusy((b) => (b ? { ...b, label: p.label } : b)))
      await addMaterialFromLink(url, (p) =>
        setBusy((b) => (b ? { ...b, label: p.label, progress: p.progress } : b)),
      )
      setLinkUrl('')
      await refresh()
      toast.success('Link saved')
    } catch (e) {
      toast.error(e?.message || 'Could not fetch that link')
    } finally {
      setBusy(null)
    }
  }

  async function onSearch() {
    const q = query.trim()
    if (!q) {
      setResults(null)
      return
    }
    setBusy({ kind: 'searching', label: 'Searching…', progress: 0 })
    try {
      await warmUpSearchModel((p) => setBusy((b) => (b ? { ...b, label: p.label } : b)))
      const out = await searchMaterials(q, { limit: 30 })
      setResults(out)
    } catch (e) {
      toast.error(e?.message || 'Search failed')
    } finally {
      setBusy(null)
    }
  }

  async function onClear() {
    const ok = window.confirm('Clear everything from this device?')
    if (!ok) return
    setBusy({ kind: 'indexing', label: 'Clearing…', progress: 0 })
    try {
      await clearAllMaterials()
      setResults(null)
      setAskResult(null)
      setAskText('')
      await refresh()
      toast.success('Library cleared')
    } catch (e) {
      toast.error(e?.message || 'Could not clear library')
    } finally {
      setBusy(null)
    }
  }

  async function onDelete(id) {
    setBusy({ kind: 'indexing', label: 'Removing…', progress: 0 })
    try {
      await deleteMaterial(id)
      await refresh()
      toast.success('Removed')
    } catch (e) {
      toast.error(e?.message || 'Could not remove')
    } finally {
      setBusy(null)
    }
  }

  function openMaterialSource(material) {
    if (material.type === 'link' && material.url) {
      const w = window.open(material.url, '_blank', 'noopener,noreferrer')
      if (!w) toast.error('Pop-up blocked. Allow pop-ups to open this link.')
      return
    }
    if (material.type === 'file' && material.fileBlob) {
      const mime = material.mimeType || material.fileBlob.type || 'application/octet-stream'
      const blob =
        material.fileBlob instanceof Blob ? material.fileBlob : new Blob([material.fileBlob], { type: mime })
      const url = URL.createObjectURL(blob)
      const w = window.open(url, '_blank', 'noopener,noreferrer')
      if (!w) {
        URL.revokeObjectURL(url)
        toast.error('Pop-up blocked. Allow pop-ups to open this file.')
        return
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000)
      return
    }
    toast.error(
      material.type === 'file'
        ? 'Original file was not stored. Add this file again to open it in the browser.'
        : 'Nothing to open.',
    )
  }

  async function onAskLibrary() {
    const q = askText.trim()
    if (!q) return
    if (!materials.length) {
      toast.error('Add at least one file or link before asking.')
      return
    }
    setAskLoading(true)
    setAskStatus('')
    setAskResult(null)
    try {
      await warmUpSearchModel((p) => setAskStatus(p.label))
      const out = await askLibrary(q, {
        onStatus: (s) => setAskStatus(s.label),
      })
      setAskResult(out)
    } catch (e) {
      toast.error(e?.message || 'Could not answer from your library')
    } finally {
      setAskLoading(false)
      setAskStatus('')
    }
  }

  return (
    <div className="noise min-h-screen">
      <Toaster
        toastOptions={{
          style: {
            background: '#fffbe8',
            color: '#2d2a20',
            border: '2px solid #2b2a21',
          },
        }}
      />

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl border-2 border-stone-900 bg-yellow-300 shadow-[0_4px_0_#2b2a21]" />
              <div>
                <div className="text-sm font-medium text-stone-700">Library</div>
                <h1 className="text-2xl font-black tracking-tight text-stone-900 sm:text-3xl">
                  Clarix
                </h1>
              </div>
            </div>
            <p className="max-w-2xl text-sm leading-relaxed text-stone-700">
              Upload PDFs, documents, and links. Search by meaning — results come from what’s inside your materials.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <FilterPill active={activeType === 'all'} onClick={() => setActiveType('all')}>
              All
            </FilterPill>
            <FilterPill active={activeType === 'file'} onClick={() => setActiveType('file')}>
              Files
            </FilterPill>
            <FilterPill active={activeType === 'link'} onClick={() => setActiveType('link')}>
              Links
            </FilterPill>
            <button
              type="button"
              onClick={onClear}
              className="ml-1 rounded-xl border-2 border-stone-900 bg-white px-3 py-2 text-sm font-bold text-stone-800 transition hover:-translate-y-0.5 hover:bg-yellow-100 focus:outline-none focus:ring-2 focus:ring-yellow-400"
            >
              Clear
            </button>
          </div>
        </header>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
          <section className="glass rounded-3xl p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex-1">
                <label className="sr-only" htmlFor="q">
                  Search
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-stone-500">
                    <SearchIcon />
                  </div>
                  <input
                    id="q"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onSearch()
                    }}
                    placeholder='Try: "find me the HTML tutorial"'
                    className="w-full rounded-2xl border-2 border-stone-900 bg-white py-3 pl-10 pr-3 text-sm text-stone-900 placeholder:text-stone-400 outline-none ring-0 transition focus:bg-yellow-50 focus:ring-2 focus:ring-yellow-400"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onSearch}
                  className="rounded-2xl border-2 border-stone-900 bg-yellow-300 px-4 py-3 text-sm font-black text-stone-900 shadow-[0_4px_0_#2b2a21] transition hover:-translate-y-0.5 hover:bg-yellow-200 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                >
                  Search
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQuery('')
                    setResults(null)
                  }}
                  className="rounded-2xl border-2 border-stone-900 bg-white px-4 py-3 text-sm font-bold text-stone-800 transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                >
                  Reset
                </button>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border-2 border-stone-900 bg-yellow-50/80 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <SparklesIcon />
                    <h2 className="text-sm font-black text-stone-900">Ask your library (AI)</h2>
                  </div>
                  <p className="mt-1 max-w-2xl text-xs leading-relaxed text-stone-700">
                    Ask any question about your uploads.{' '}
                    <span className="font-semibold">For accurate AI answers:</span> get a{' '}
                    <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="underline font-bold text-stone-900 hover:text-yellow-700">
                      free Gemini API key
                    </a>{' '}
                    and set <code className="rounded bg-white px-1 py-0.5 text-[11px]">VITE_GEMINI_API_KEY</code> in{' '}
                    <code className="rounded bg-white px-1 py-0.5 text-[11px]">.env</code>.
                    Without a key, you'll see relevant passages from your files.
                  </p>
                </div>
              </div>

              <label className="sr-only" htmlFor="ask">
                Ask your library
              </label>
              <textarea
                id="ask"
                value={askText}
                onChange={(e) => setAskText(e.target.value)}
                rows={3}
                placeholder='e.g. "How many days was the OJT?" or "What tech stack is used?"'
                disabled={!!busy || askLoading}
                className="mt-3 w-full resize-y rounded-2xl border-2 border-stone-900 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 outline-none transition focus:bg-yellow-50 focus:ring-2 focus:ring-yellow-400 disabled:opacity-60"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onAskLibrary}
                  disabled={!!busy || askLoading || !askText.trim()}
                  className="rounded-2xl border-2 border-stone-900 bg-yellow-300 px-4 py-2.5 text-sm font-black text-stone-900 shadow-[0_3px_0_#2b2a21] transition hover:-translate-y-0.5 hover:bg-yellow-200 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                >
                  {askLoading ? 'Working…' : 'Ask'}
                </button>
                {askStatus ? (
                  <span className="text-xs font-semibold text-stone-600">{askStatus}</span>
                ) : null}
              </div>

              {askResult ? (
                <div className="mt-4 rounded-2xl border-2 border-stone-900 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-bold text-stone-500">
                      {askResult.mode === 'gemini' || askResult.mode === 'openai'
                        ? '✨ AI Answer (cloud)'
                        : askResult.mode === 'local'
                          ? '📄 Relevant passages from your files'
                          : askResult.mode === 'no_match'
                            ? 'No match'
                            : askResult.mode === 'weak'
                              ? 'Weak match'
                              : 'Answer'}
                    </div>
                  </div>
                  <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-stone-800">{askResult.answer}</div>
                  {askResult.sources?.length ? (
                    <div className="mt-4 border-t-2 border-stone-200 pt-3">
                      <div className="text-xs font-black text-stone-900">Open a source</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {askResult.sources.map((s) => (
                          <button
                            key={s.materialId}
                            type="button"
                            onClick={() => {
                              const m = materials.find((x) => x.id === s.materialId)
                              if (m) openMaterialSource(m)
                              else toast.error('That item is no longer in your library.')
                            }}
                            className="max-w-full truncate rounded-xl border-2 border-stone-900 bg-yellow-200 px-3 py-1.5 text-left text-xs font-bold text-stone-900 transition hover:bg-yellow-300 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                          >
                            <span className="mr-1 inline-flex align-middle">
                              <TypeBadge type={s.type} />
                            </span>
                            {s.title}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="text-xs text-stone-600">
                {results ? (
                  <>
                    Showing <span className="font-bold text-stone-900">{visible.length}</span> matches
                  </>
                ) : (
                  <>
                    <span className="font-bold text-stone-900">{materials.length}</span> items in your library
                  </>
                )}
              </div>
              <div className="text-xs text-stone-500">
                {materials.length ? 'Click a row to open the link or file. Stored locally on this device.' : 'Add your first material to begin'}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3">
              {loading ? (
                <SkeletonList />
              ) : visible.length ? (
                <AnimatePresence initial={false}>
                  {visible.map(({ material, best }) => (
                    <motion.div
                      key={material.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 6 }}
                      transition={{ duration: 0.16 }}
                    >
                      <MaterialRow
                        material={material}
                        best={best}
                        onOpenSource={() => openMaterialSource(material)}
                        onDelete={() => onDelete(material.id)}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              ) : (
                <EmptyState
                  hasQuery={!!query.trim()}
                  onAdd={() => fileInputRef.current?.click()}
                  onReset={() => {
                    setQuery('')
                    setResults(null)
                  }}
                />
              )}
            </div>
          </section>

          <aside className="space-y-4">
            <section className="glass rounded-3xl p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black text-stone-900">Add materials</h2>
                <span className="text-xs text-stone-600">PDF · DOCX · TXT · MD</span>
              </div>

              <div className="mt-3">
                <input
                  ref={fileInputRef}
                  className="hidden"
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.txt,.md,.rtf,.html,.htm"
                  onChange={(e) => onPickFiles(e.target.files)}
                />

                <Dropzone
                  onPick={() => fileInputRef.current?.click()}
                  onDropFiles={(files) => onPickFiles(files)}
                  disabled={!!busy}
                />
              </div>

              <div className="mt-4">
                <div className="text-xs font-bold text-stone-700">Save a link</div>
                <div className="mt-2 flex gap-2">
                  <input
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://…"
                    className="w-full rounded-2xl border-2 border-stone-900 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 outline-none transition focus:bg-yellow-50 focus:ring-2 focus:ring-yellow-400"
                  />
                  <button
                    type="button"
                    onClick={onAddLink}
                    disabled={!!busy || !linkUrl.trim()}
                    className="rounded-2xl border-2 border-stone-900 bg-yellow-300 px-3 py-2.5 text-sm font-black text-stone-900 transition hover:bg-yellow-200 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  >
                    Save
                  </button>
                </div>
                <div className="mt-2 text-xs text-stone-600">
                  Links are fetched and indexed so search works on their content too.
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>

      <AnimatePresence>
        {busy ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/30 p-4 backdrop-blur-sm sm:items-center"
          >
            <motion.div
              initial={{ y: 18, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 10, opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="glass w-full max-w-md rounded-3xl p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-stone-900">{busy.label}</div>
                  <div className="mt-1 text-xs text-stone-700">
                    This runs locally and may take a moment the first time.
                  </div>
                </div>
                <div className="mt-1 h-2.5 w-2.5 animate-pulse rounded-full bg-yellow-400" />
              </div>

              {busy.kind === 'indexing' ? (
                <div className="mt-4">
                  <div className="h-2 w-full overflow-hidden rounded-full border border-stone-900 bg-yellow-100">
                    <div
                      className="h-full rounded-full bg-yellow-400 transition-[width]"
                      style={{ width: `${Math.max(4, Math.min(100, Math.round((busy.progress || 0) * 100)))}%` }}
                    />
                  </div>
                </div>
              ) : null}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function FilterPill({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-xl border-2 px-3 py-2 text-sm font-bold transition focus:outline-none focus:ring-2 focus:ring-yellow-400',
        active
          ? 'border-stone-900 bg-yellow-300 text-stone-900'
          : 'border-stone-900 bg-white text-stone-700 hover:bg-yellow-100 hover:text-stone-900',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function Dropzone({ onPick, onDropFiles, disabled }) {
  const [over, setOver] = useState(false)
  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!disabled) setOver(true)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onDragLeave={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        if (disabled) return
        const files = e.dataTransfer?.files
        if (files?.length) onDropFiles(files)
      }}
      className={[
        'rounded-2xl border-2 border-dashed p-4 transition',
        over ? 'border-stone-900 bg-yellow-100' : 'border-stone-900 bg-white hover:bg-yellow-50',
        disabled ? 'opacity-60' : '',
      ].join(' ')}
    >
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl border-2 border-stone-900 bg-yellow-200 text-stone-800">
          <UploadIcon />
        </div>
        <div className="flex-1">
          <div className="text-sm font-black text-stone-900">Drop files here</div>
          <div className="mt-0.5 text-xs text-stone-600">or click to browse</div>
        </div>
        <button
          type="button"
          onClick={onPick}
          disabled={disabled}
          className="rounded-xl border-2 border-stone-900 bg-yellow-300 px-3 py-2 text-sm font-black text-stone-900 transition hover:bg-yellow-200 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-yellow-400"
        >
          Browse
        </button>
      </div>
    </div>
  )
}

function MaterialRow({ material, best, onOpenSource, onDelete }) {
  const score = best?.score ?? null
  return (
    <div
      className="group flex cursor-pointer items-start justify-between gap-3 rounded-2xl border-2 border-stone-900 bg-white p-4 transition hover:bg-yellow-50"
      onClick={onOpenSource}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpenSource()
      }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <TypeBadge type={material.type} />
          <div className="truncate text-sm font-black text-stone-900">{material.title}</div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-stone-500">
          <span className="truncate">{material.sourceLabel}</span>
          <span>•</span>
          <span>{formatTime(material.createdAt)}</span>
          {score != null ? (
            <>
              <span>•</span>
              <span className="text-stone-700">match {Math.round(score * 100)}%</span>
            </>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onDelete()
        }}
        className="mt-0.5 shrink-0 rounded-xl border-2 border-stone-900 bg-yellow-200 px-2.5 py-1.5 text-xs font-black text-stone-900 opacity-100 transition hover:bg-yellow-300 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-yellow-400"
        aria-label="Remove"
      >
        Remove
      </button>
    </div>
  )
}

function TypeBadge({ type }) {
  const isLink = type === 'link'
  return (
    <span
      className={[
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
        isLink ? 'border border-stone-900 bg-yellow-200 text-stone-900' : 'border border-stone-900 bg-white text-stone-900',
      ].join(' ')}
    >
      {isLink ? 'Link' : 'File'}
    </span>
  )
}

function EmptyState({ hasQuery, onAdd, onReset }) {
  return (
    <div className="rounded-2xl border-2 border-stone-900 bg-white p-6 text-left">
      <div className="text-sm font-black text-stone-900">{hasQuery ? 'No matches' : 'Nothing here yet'}</div>
      <div className="mt-1 text-sm text-stone-700">
        {hasQuery
          ? 'Try a different phrasing. Natural language works best.'
          : 'Upload a PDF or document, or save a link to start building your library.'}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onAdd}
          className="rounded-2xl border-2 border-stone-900 bg-yellow-300 px-4 py-2.5 text-sm font-black text-stone-900 transition hover:bg-yellow-200 focus:outline-none focus:ring-2 focus:ring-yellow-400"
        >
          Add material
        </button>
        {hasQuery ? (
          <button
            type="button"
            onClick={onReset}
            className="rounded-2xl border-2 border-stone-900 bg-white px-4 py-2.5 text-sm font-black text-stone-800 transition hover:bg-yellow-100 focus:outline-none focus:ring-2 focus:ring-yellow-400"
          >
            Reset search
          </button>
        ) : null}
      </div>
    </div>
  )
}

function SkeletonList() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border-2 border-stone-900 bg-white p-4"
        >
          <div className="h-4 w-48 animate-pulse rounded bg-yellow-200" />
          <div className="mt-3 h-3 w-full animate-pulse rounded bg-yellow-100" />
          <div className="mt-2 h-3 w-5/6 animate-pulse rounded bg-yellow-100" />
        </div>
      ))}
    </div>
  )
}

function formatTime(ts) {
  try {
    const d = new Date(ts)
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
  } catch {
    return ''
  }
}

function SparklesIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-stone-800" aria-hidden="true">
      <path
        d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M12 8.5c-1.2 2.4-2.1 3.3-4.5 4.5 2.4 1.2 3.3 2.1 4.5 4.5 1.2-2.4 2.1-3.3 4.5-4.5-2.4-1.2-3.3-2.1-4.5-4.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M16.6 16.6 21 21"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3v10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M8.5 6.5 12 3l3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 14v4a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

export default App
