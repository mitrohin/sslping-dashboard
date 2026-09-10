import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyBuildArtifacts } from './deploy/verify-build-artifacts.mjs'

const directories = []
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })))
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'sslping-build-'))
  directories.push(directory)
  mkdirSync(path.join(directory, 'assets'))
  const write = (file, value) => writeFileSync(path.join(directory, file), value)
  write('index.html', '<script src="/assets/app-abc12345.js"></script><link href="/assets/app-def12345.css">')
  write('assets/app.js', 'import "./app-abc12345.js";\n')
  write('assets/app-abc12345.js', 'export const shared=1; import("./chunk-lazy-abc12345.js");')
  write('assets/chunk-lazy-abc12345.js', 'import {shared} from "./app-abc12345.js";')
  write('assets/app.css', '.ps-main{color:red}')
  write('assets/app-def12345.css', '.ps-main{color:red}')
  return { directory, write }
}

describe('built dashboard and public status entry contract', () => {
  it('accepts one canonical entry for both the status loader and lazy back-imports', () => {
    const { directory } = fixture()
    expect(verifyBuildArtifacts(directory).modules).toBe(2)
  })
  it('rejects HTML that still consumes a stable browser-cached entry', () => {
    const { directory, write } = fixture()
    write('index.html', '<script src="/assets/app.js"></script><link href="/assets/app-def12345.css">')
    expect(() => verifyBuildArtifacts(directory)).toThrow(/hashed main/)
  })
  it('rejects a copied entry implementation instead of a graph-safe loader', () => {
    const { directory, write } = fixture()
    write('assets/app.js', 'createRoot(document.getElementById("root"));')
    expect(() => verifyBuildArtifacts(directory)).toThrow(/canonical hashed entry/)
  })
  it('rejects a lazy chunk importing the stable loader', () => {
    const { directory, write } = fixture()
    write('assets/chunk-lazy-abc12345.js', 'import {shared} from "./app.js";')
    expect(() => verifyBuildArtifacts(directory)).toThrow(/duplicate the entry module/)
  })
  it('rejects a stale public status stylesheet alias', () => {
    const { directory, write } = fixture()
    write('assets/app.css', '.ps-main{color:blue}')
    expect(() => verifyBuildArtifacts(directory)).toThrow(/byte-identical/)
  })
  it('rejects missing lazy module output', () => {
    const { directory } = fixture()
    rmSync(path.join(directory, 'assets/chunk-lazy-abc12345.js'))
    expect(() => verifyBuildArtifacts(directory)).toThrow(/missing imported module/)
  })
})
