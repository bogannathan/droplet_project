#!/usr/bin/env node
// Strip verbose "response", "agent", and "result.metadata" fields from a chat export.
// Usage: node scripts/strip_chat.mjs [input] [output]
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const input = resolve(process.argv[2] ?? 'traffic_chat.json')
const output = resolve(process.argv[3] ?? input.replace(/\.json$/, '.stripped.json'))

const STRIP_KEYS = new Set(['response', 'agent'])

function strip(value, parentKey) {
  if (Array.isArray(value)) return value.map((v) => strip(v, parentKey))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (STRIP_KEYS.has(k)) continue
      if (k === 'metadata' && parentKey === 'result') continue
      out[k] = strip(v, k)
    }
    return out
  }
  return value
}

const raw = await readFile(input, 'utf8')
const data = JSON.parse(raw)
const stripped = strip(data)
await writeFile(output, JSON.stringify(stripped, null, 2))

const beforeKb = (Buffer.byteLength(raw) / 1024).toFixed(1)
const afterKb = (Buffer.byteLength(JSON.stringify(stripped)) / 1024).toFixed(1)
console.log(`Wrote ${output}`)
console.log(`Size: ${beforeKb} KB -> ${afterKb} KB (minified)`)
