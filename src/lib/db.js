import { del, get, keys, set } from 'idb-keyval'

const KEY_PREFIX = 'sms:material:'
const INDEX_KEY = 'sms:index'

function k(id) {
  return `${KEY_PREFIX}${id}`
}

export async function getAll() {
  const index = (await get(INDEX_KEY)) || []
  const items = await Promise.all(index.map((id) => get(k(id))))
  return items.filter(Boolean).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

export async function put(item) {
  const id = item.id
  await set(k(id), item)
  const index = (await get(INDEX_KEY)) || []
  if (!index.includes(id)) {
    await set(INDEX_KEY, [id, ...index])
  }
}

export async function remove(id) {
  await del(k(id))
  const index = (await get(INDEX_KEY)) || []
  await set(
    INDEX_KEY,
    index.filter((x) => x !== id),
  )
}

export async function clearAll() {
  const allKeys = await keys()
  const toDelete = allKeys.filter(
    (x) => x === INDEX_KEY || (typeof x === 'string' && x.startsWith(KEY_PREFIX)),
  )
  await Promise.all(toDelete.map((x) => del(x)))
}

