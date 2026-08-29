import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export class CredentialVault {
  constructor(keyPath) {
    this.keyPath = keyPath
    this.key = this.#loadOrCreateKey()
  }

  #loadOrCreateKey() {
    mkdirSync(dirname(this.keyPath), { recursive: true, mode: 0o700 })
    if (!existsSync(this.keyPath)) {
      writeFileSync(this.keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' })
    }
    chmodSync(this.keyPath, 0o600)
    const key = readFileSync(this.keyPath)
    if (key.length !== 32) throw new Error(`Credential key at ${this.keyPath} must be 32 bytes`)
    return key
  }

  encrypt(plaintext) {
    if (plaintext === null || plaintext === undefined || plaintext === '') return null
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`
  }

  decrypt(envelope) {
    if (!envelope) return ''
    const [version, ivText, tagText, bodyText] = String(envelope).split('.')
    if (version !== 'v1' || !ivText || !tagText || bodyText === undefined) throw new Error('Unsupported credential envelope')
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivText, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(bodyText, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  }
}
