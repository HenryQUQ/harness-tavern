export const $ = (selector, root = document) => root.querySelector(selector)
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]

export function el(tag, options = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(options)) {
    if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value ?? ''
    else if (key === 'html') node.innerHTML = value ?? ''
    else if (key === 'dataset') Object.assign(node.dataset, value)
    else if (key === 'on') for (const [event, listener] of Object.entries(value)) node.addEventListener(event, listener)
    else if (key in node && !key.startsWith('aria')) node[key] = value
    else node.setAttribute(key, value)
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue
    node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return node
}

export function clear(node) {
  node.replaceChildren()
  return node
}

export function initials(name) {
  return String(name || '?').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase()
}

export function avatar(entity, size = 'md') {
  const url = entity?.avatar_url || entity?.cover_url
  if (url) return el('img', { class: `avatar avatar-${size}`, src: url, alt: entity?.name || entity?.title || '' })
  return el('span', { class: `avatar avatar-${size} avatar-fallback`, text: initials(entity?.name || entity?.title) })
}

export function relativeTime(value, locale = 'en') {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return ''
  const delta = timestamp - Date.now()
  const abs = Math.abs(delta)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (abs < 60_000) return rtf.format(Math.round(delta / 1000), 'second')
  if (abs < 3_600_000) return rtf.format(Math.round(delta / 60_000), 'minute')
  if (abs < 86_400_000) return rtf.format(Math.round(delta / 3_600_000), 'hour')
  if (abs < 2_592_000_000) return rtf.format(Math.round(delta / 86_400_000), 'day')
  return new Date(timestamp).toLocaleDateString(locale)
}

export function lines(value) {
  return String(value || '').split('\n').map(line => line.trim()).filter(Boolean)
}

export function commaList(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean)
}

export function safeMarkdown(text) {
  const fragment = document.createDocumentFragment()
  const source = String(text ?? '')
  const parts = source.split(/(\*[^*\n]+\*|\n)/g)
  for (const part of parts) {
    if (part === '\n') fragment.append(document.createElement('br'))
    else if (/^\*[^*]+\*$/.test(part)) fragment.append(el('em', { text: part.slice(1, -1) }))
    else fragment.append(document.createTextNode(part))
  }
  return fragment
}

export function formObject(form) {
  return Object.fromEntries(new FormData(form).entries())
}
