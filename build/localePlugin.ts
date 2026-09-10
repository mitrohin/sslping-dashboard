import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import ts from 'typescript'
import type { Plugin } from 'vite'

const locales = ['en', 'es', 'zh', 'ka', 'tr', 'ru']
const groups = ['core', 'feature', 'billing', 'account', 'secondary', 'subscription', 'network']

// Keep the existing editable translation sources. Only the requested language
// becomes a browser chunk; English fallbacks are resolved during the build.
export function localePlugin(): Plugin {
  let root = process.cwd()
  let testMode = false
  return {
    name: 'sslping-locale-chunks',
    configResolved(config) { root = config.root; testMode = config.mode === 'test' },
    resolveId(id) {
      if (id === 'virtual:sslping-fallback' || /^virtual:sslping-(admin-)?locale\/(en|es|zh|ka|tr|ru)$/.test(id)) return `\0${id}`
    },
    async load(id) {
      const fallback = id === '\0virtual:sslping-fallback'
      const match = fallback ? ['', '', 'en'] : id.match(/^\0virtual:sslping-(admin-)?locale\/(en|es|zh|ka|tr|ru)$/)
      if (!match) return
      const locale = match[2]
      const messages: Record<string, string> = {}
      for (const group of match[1] ? ['admin'] : fallback && testMode ? [...groups, 'admin'] : groups) {
        const path = resolve(root, `src/app/${group}Translations.ts`)
        this.addWatchFile(path)
        const source = await readFile(path, 'utf8')
        const compiled = ts.transpileModule(source, {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        }).outputText
        const module = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
        const table = module[`${group}Translations`] as Record<string, Record<string, string>>
        if (!table || locales.some((code) => !table[code])) throw new Error(`Incomplete locale source: ${group}`)
        Object.assign(messages, table.en, table[locale])
      }
      return `export default ${JSON.stringify(messages)};`
    },
  }
}
