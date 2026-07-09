import { rm, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const publicDir = path.resolve(__dirname, '../../backend/public')

const cleanupTargets = [
  'assets',
  'manifest.webmanifest',
  'registerSW.js',
  'sw.js',
]

for (const target of cleanupTargets) {
  await rm(path.join(publicDir, target), { recursive: true, force: true })
}

for (const entry of await readdir(publicDir)) {
  if (entry.startsWith('workbox-') && entry.endsWith('.js')) {
    await rm(path.join(publicDir, entry), { force: true })
  }
}
