import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function verifyBuildArtifacts(directory) {
  const html = readFileSync(path.join(directory, 'index.html'), 'utf8')
  const script = html.match(/src="\/(assets\/app-[A-Za-z0-9_-]+\.js)"/)?.[1]
  const css = html.match(/href="\/(assets\/app-[A-Za-z0-9_-]+\.css)"/)?.[1]
  assert.ok(script && css, 'Dashboard HTML must reference hashed main JS and CSS')
  assert.doesNotMatch(html, /(?:src|href)="\/assets\/app\.(?:js|css)"/, 'Dashboard must not consume stable aliases')
  const wrapper = readFileSync(path.join(directory, 'assets/app.js'), 'utf8')
  assert.equal(wrapper, `import ${JSON.stringify(`./${path.basename(script)}`)};\n`, 'Stable loader must import the canonical hashed entry exactly once')
  assert.deepEqual(readFileSync(path.join(directory, 'assets/app.css')), readFileSync(path.join(directory, css)), 'Public status CSS must be byte-identical to eager main CSS')
  assert.match(readFileSync(path.join(directory, css), 'utf8'), /\.ps-/, 'Public status CSS must be available before lazy hydration')
  assert.ok(existsSync(path.join(directory, script)), 'Canonical main entry must exist')

  const files = readdirSync(path.join(directory, 'assets')).filter(file => file.endsWith('.js') && file !== 'app.js')
  for (const file of files) {
    const source = readFileSync(path.join(directory, 'assets', file), 'utf8')
    const imports = source.matchAll(/\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g)
    for (const match of imports) {
      const target = match[1] ?? match[2] ?? match[3]
      assert.ok(!/(?:^|\/)app\.js(?:[?#]|$)/.test(target), `${file} must not import the stable loader and duplicate the entry module`)
      if (target.startsWith('.')) {
        assert.ok(existsSync(path.resolve(directory, 'assets', target)), `${file}: missing imported module ${target}`)
      }
    }
  }
  return { script, css, modules: files.length }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verifyBuildArtifacts(path.resolve(process.argv[2] ?? 'dist'))
  console.log(`PASS: hashed HTML entries, stable status aliases, eager CSS and ${result.modules} module imports`)
}
