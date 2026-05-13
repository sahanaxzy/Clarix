import { pipeline, env } from '@xenova/transformers'

env.allowLocalModels = false
env.useBrowserCache = true

let modelPromise = null

export async function loadEmbedder({ onStatus } = {}) {
  if (!modelPromise) {
    onStatus?.({ label: 'Loading search model…' })
    modelPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true,
      pooling: 'mean',
      normalize: true,
    })
  }
  return await modelPromise
}

export async function embed(text) {
  const fn = await loadEmbedder()
  const out = await fn(text)

  const v = Array.isArray(out) ? out : out?.data
  if (Array.isArray(v)) return new Float32Array(v)

  if (out?.data && out?.dims?.length) return new Float32Array(out.data)
  if (out?.data) return new Float32Array(out.data)

  throw new Error('Embedding failed')
}

