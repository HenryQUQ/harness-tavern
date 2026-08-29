const card = document.querySelector('#shareCard')
const token = decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1) || '')

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value ?? ''
    else if (key === 'href') node.href = value
    else if (key === 'download') node.download = value
    else if (key === 'hidden') node.hidden = Boolean(value)
    else if (value !== false && value != null) node.setAttribute(key, String(value))
  }
  node.append(...children.filter(Boolean))
  return node
}

function initials(name) {
  return String(name || '?').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
}

function avatar(person) {
  if (person?.avatar_url) return el('img', { class: 'avatar lg', alt: '', src: person.avatar_url })
  return el('span', { class: 'avatar lg', text: initials(person?.name) })
}

function previewData(share) {
  const snapshot = share.snapshot || {}
  if (snapshot.kind === 'character-preview') return { type: 'Character', item: snapshot.character, cast: [snapshot.character] }
  if (snapshot.kind === 'story-preview') return { type: 'Story', item: snapshot.story, cast: snapshot.story?.cast?.map(member => member.character || member) || [] }
  if (snapshot.kind === 'playthrough-preview') return { type: 'Playthrough', item: { ...snapshot.story, title: snapshot.title, summary: snapshot.messages?.at(-1)?.content }, cast: snapshot.characters || [], messages: snapshot.messages || [] }
  const items = snapshot.items || {}
  if (snapshot.kind === 'character') return { type: 'Character remix pack', item: items.characters?.[0], cast: items.characters?.slice(0, 4) || [] }
  if (snapshot.kind === 'story') return { type: 'Story remix pack', item: items.stories?.[0], cast: items.characters?.slice(0, 4) || [] }
  return { type: 'Tavern pack', item: { title: share.title, summary: 'Portable Tavern content' }, cast: [] }
}

function render(share) {
  const { type, item = {}, cast, messages } = previewData(share)
  document.title = `${share.title} · Harness Tavern`
  const tags = [...(item.tags || []), item.genre, item.tone].filter(Boolean).slice(0, 5)
  const actions = el('div', { class: 'share-public-actions' },
    el('a', { class: 'button', href: share.can_import ? `/?shared=${encodeURIComponent(token)}#import` : '/' }, document.createTextNode(share.can_import ? 'Import into this Tavern' : 'Open Harness Tavern')),
    share.can_import ? el('a', { class: 'button secondary', href: `/api/public/shares/${encodeURIComponent(token)}/download`, download: `${share.title}.tavern.json` }, document.createTextNode('Download portable pack')) : null,
  )
  const castNode = cast?.length ? el('section', { class: 'share-public-section' }, el('h2', { text: 'Cast' }), el('div', { class: 'share-public-cast' }, ...cast.map(person => el('div', { class: 'share-person' }, avatar(person), el('span', {}, el('strong', { text: person.name }), el('small', { text: person.tagline || person.role || '' })))))) : null
  const excerpt = messages?.length ? el('section', { class: 'share-public-section' }, el('h2', { text: 'Latest scene' }), ...messages.slice(-4).map(message => el('blockquote', { class: `share-excerpt ${message.role}` }, el('strong', { text: message.role === 'user' ? 'Player' : (cast.find(person => person.id === message.actor_id)?.name || 'Story') }), el('p', { text: message.content })))) : null
  card.replaceChildren(
    el('p', { class: 'eyebrow', text: type }),
    el('div', { class: 'share-public-heading' }, el('div', {}, el('h1', { text: item.title || item.name || share.title }), el('p', { text: item.hook || item.tagline || item.summary || item.description || '' })), cast?.length ? el('div', { class: 'avatar-stack' }, ...cast.slice(0, 4).map(avatar)) : null),
    tags.length ? el('div', { class: 'card-meta' }, ...tags.map(tag => el('span', { class: 'tag', text: tag }))) : null,
    item.premise ? el('p', { class: 'share-premise', text: item.premise }) : null,
    castNode,
    excerpt,
    actions,
    el('p', { class: 'microcopy', text: `Shared as ${share.scope === 'remix' ? 'an importable copy' : 'a view-only preview'} · Expires ${new Date(share.expires_at).toLocaleDateString()}` }),
  )
}

fetch(`/api/public/shares/${encodeURIComponent(token)}`, { headers: { accept: 'application/json' } })
  .then(async response => {
    const data = await response.json().catch(() => null)
    if (!response.ok) throw new Error(data?.error?.message || 'This share is unavailable.')
    return data
  })
  .then(render)
  .catch(error => {
    card.replaceChildren(el('p', { class: 'eyebrow', text: 'Harness Tavern' }), el('h1', { text: 'This door no longer opens.' }), el('p', { text: error.message }), el('a', { class: 'button', href: '/' }, document.createTextNode('Go to Tavern home')))
  })
