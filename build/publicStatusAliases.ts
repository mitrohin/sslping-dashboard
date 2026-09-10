import type { Plugin } from 'vite'

// Dashboard HTML uses content-addressed entries. API-rendered status HTML has
// a separate rollout, so retain its stable JS loader and eager stylesheet.
export function publicStatusAliases(): Plugin {
  return {
    name: 'sslping-public-status-aliases',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const html = bundle['index.html']
        if (html?.type !== 'asset' || typeof html.source !== 'string') {
          this.error('Public status aliases require the generated index.html')
        }
        const entry = html.source.match(/src="\/(assets\/app-[A-Za-z0-9_-]+\.js)"/)?.[1]
        const stylesheet = html.source.match(/href="\/(assets\/app-[A-Za-z0-9_-]+\.css)"/)?.[1]
        const css = stylesheet && bundle[stylesheet]
        if (!entry || bundle[entry]?.type !== 'chunk' || !css || css.type !== 'asset') {
          this.error('Public status aliases require hashed main JavaScript and CSS')
        }
        // Do not copy the entry bytes: lazy chunks import its exports and must
        // resolve to the same module URL, otherwise React/bootstrap runs twice.
        this.emitFile({ type: 'asset', fileName: 'assets/app.js', source: `import ${JSON.stringify(`./${entry.slice('assets/'.length)}`)};\n` })
        this.emitFile({ type: 'asset', fileName: 'assets/app.css', source: css.source })
      },
    },
  }
}
