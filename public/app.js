import { api, downloadJson, getAccessToken, setAccessToken, streamTurn } from './lib/api.js'
import { $, $$, avatar, clear, el, formObject, relativeTime, safeMarkdown, lines } from './lib/dom.js'
import { getLocale, setLocale, t } from './lib/i18n.js'

const state = {
  boot: null,
  view: 'home',
  libraryTab: 'characters',
  conversationId: null,
  conversation: null,
  streaming: false,
  modal: null,
  selectedTemplate: null,
  importContent: null,
}

function toast(message, duration = 3200) {
  const node = $('#toast')
  node.textContent = message
  node.classList.remove('hidden')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => node.classList.add('hidden'), duration)
}

function applyTranslations() {
  $$('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n) })
  $$('[data-i18n-placeholder]').forEach(node => { node.placeholder = t(node.dataset.i18nPlaceholder) })
}

function currentDefaultPersona() {
  return state.boot.personas.find(item => item.id === state.boot.user_profile.default_persona_id)
    || state.boot.personas[0]
    || null
}

function favoriteSet() {
  const set = new Set()
  for (const item of state.boot.home.characters) if (item.favorite) set.add(`character:${item.id}`)
  for (const item of state.boot.home.stories) if (item.favorite) set.add(`story:${item.id}`)
  for (const item of state.boot.home.continue) if (item.favorite) set.add(`conversation:${item.id}`)
  return set
}

async function refresh({ preserveView = true } = {}) {
  const view = state.view
  state.boot = await api('/api/bootstrap')
  setLocale(state.boot.user_profile.locale || (navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'))
  applyTranslations()
  renderAll()
  if (preserveView) showView(view, { updateHash: false })
}

function showView(view, { updateHash = true } = {}) {
  if (!['home', 'chats', 'library', 'create', 'settings', 'chat'].includes(view)) view = 'home'
  state.view = view
  $$('.view').forEach(node => node.classList.toggle('active', node.id === `view-${view}`))
  $$('#primaryNav button, #settingsNav').forEach(button => button.classList.toggle('active', button.dataset.view === view))
  if (updateHash && view !== 'chat') history.replaceState(null, '', `#${view}`)
  closeMobileNav()
  if (view === 'home') renderHome()
  if (view === 'chats') renderChats()
  if (view === 'library') renderLibrary()
  if (view === 'create') renderCreate()
  if (view === 'settings') renderSettings()
}

function openMobileNav() {
  $('.sidebar').classList.add('open')
  $('#mobileScrim').classList.remove('hidden')
}
function closeMobileNav() {
  $('.sidebar').classList.remove('open')
  $('#mobileScrim').classList.add('hidden')
}

function openModal(title, content, { wide = false, autoFocus = true } = {}) {
  $('#modalTitle').textContent = title
  clear($('#modalBody')).append(content)
  $('#modal').classList.toggle('modal-wide', wide)
  $('#modalLayer').classList.remove('hidden')
  state.modal = title
  if (autoFocus) setTimeout(() => $('#modalBody input, #modalBody textarea, #modalBody select')?.focus(), 20)
}
function closeModal() {
  $('#modalLayer').classList.add('hidden')
  state.modal = null
}
function openDrawer(title, content) {
  $('#drawerTitle').textContent = title
  clear($('#drawerBody')).append(content)
  $('#drawer').classList.remove('hidden')
  $('#mobileScrim').classList.remove('hidden')
}
function closeDrawer() {
  $('#drawer').classList.add('hidden')
  if (!$('.sidebar').classList.contains('open')) $('#mobileScrim').classList.add('hidden')
}

function emptyState(message, action = null) {
  return el('div', { class: 'empty-state' }, el('p', { text: message }), action)
}

function castStack(cast, size = 'sm') {
  return el('div', { class: 'avatar-stack' }, ...(cast || []).slice(0, 4).map(item => avatar(item.character || item, size)))
}

function continueCard(item) {
  const button = el('button', { on: { click: () => openConversation(item.id) } })
  button.append(
    el('div', { class: 'continue-card-head' }, castStack(item.cast, 'md'), el('div', {}, el('h3', { text: item.title }), el('small', { text: item.current_scene?.location || item.subtitle || '' }))),
    el('p', { text: item.last_preview || item.subtitle || t('noRecent') }),
    el('div', { class: 'continue-card-footer' }, el('span', { text: item.current_scene?.title || '' }), el('span', { text: relativeTime(item.updated_at, getLocale()) })),
  )
  return el('article', { class: 'continue-card' }, button)
}

function characterCard(character) {
  const cover = el('div', { class: 'card-cover' }, avatar(character, 'xl'))
  const content = el('div', { class: 'card-content' },
    el('h3', { text: character.name }),
    el('p', { text: character.description || character.personality }),
    el('div', { class: 'card-meta' }, ...(character.tags || []).slice(0, 3).map(tag => el('span', { class: 'tag', text: tag }))),
  )
  return el('article', { class: 'content-card character-card' }, el('button', { class: 'card-button', on: { click: () => openCharacterProfile(character.id) } }, cover, content))
}

function storyCard(story) {
  const cover = el('div', { class: 'card-cover' }, castStack(story.cast, 'lg'))
  const content = el('div', { class: 'card-content' },
    el('h3', { text: story.title }),
    el('p', { text: story.hook || story.summary }),
    el('div', { class: 'card-meta' }, el('span', { class: 'tag', text: story.genre || 'Story' }), el('span', { text: `${story.cast?.length || 0} cast` })),
  )
  return el('article', { class: 'content-card story-card' }, el('button', { class: 'card-button', on: { click: () => openStoryDetail(story.id) } }, cover, content))
}

function personaCard(persona) {
  return el('article', { class: 'content-card character-card' }, el('button', { class: 'card-button', on: { click: () => openPersonaEditor(persona.id) } },
    el('div', { class: 'card-cover' }, avatar(persona, 'xl')),
    el('div', { class: 'card-content' }, el('h3', { text: persona.name }), el('p', { text: persona.description }), el('div', { class: 'card-meta' }, el('span', { class: 'tag', text: 'Persona' }))),
  ))
}

function renderHome() {
  if (!state.boot) return
  const home = state.boot.home
  const continueGrid = clear($('#continueGrid'))
  if (!home.continue.length) continueGrid.append(emptyState(t('noRecent'), el('button', { text: t('enterStory'), on: { click: () => { state.libraryTab = 'stories'; showView('library') } } })))
  else continueGrid.append(...home.continue.slice(0, 6).map(continueCard))
  clear($('#homeCharacterGrid')).append(...home.characters.slice(0, 8).map(characterCard))
  clear($('#homeStoryGrid')).append(...home.stories.slice(0, 8).map(storyCard))
}

function renderChats() {
  const grid = clear($('#chatGrid'))
  if (!state.boot.conversations.length) {
    grid.append(emptyState(t('noRecent'), el('button', { text: t('talkCharacter'), on: { click: () => { state.libraryTab = 'characters'; showView('library') } } })))
    return
  }
  const homeById = new Map(state.boot.home.continue.map(item => [item.id, item]))
  grid.append(...state.boot.conversations.map(conversation => {
    const item = homeById.get(conversation.id) || { ...conversation, cast: [], subtitle: '', current_scene: null }
    return el('article', { class: 'conversation-card' }, el('button', { on: { click: () => openConversation(conversation.id) } },
      el('div', { class: 'continue-card-head' }, castStack(item.cast, 'md'), el('div', {}, el('h3', { text: conversation.title }), el('small', { text: item.current_scene?.location || item.subtitle || '' }))),
      el('p', { text: conversation.last_preview || item.subtitle || t('noRecent') }),
      el('div', { class: 'continue-card-footer' }, el('span', { text: conversation.story_id ? 'Story playthrough' : 'Character chat' }), el('span', { text: relativeTime(conversation.updated_at, getLocale()) })),
    ))
  }))
}

function renderLibrary() {
  $$('#libraryTabs button').forEach(button => button.classList.toggle('active', button.dataset.tab === state.libraryTab))
  const query = $('#librarySearch').value.toLocaleLowerCase().trim()
  const grid = clear($('#libraryGrid'))
  const match = item => JSON.stringify(item).toLocaleLowerCase().includes(query)
  if (state.libraryTab === 'characters') grid.append(...state.boot.characters.filter(match).map(characterCard))
  if (state.libraryTab === 'stories') grid.append(...state.boot.stories.filter(match).map(storyCard))
  if (state.libraryTab === 'personas') grid.append(...state.boot.personas.filter(match).map(personaCard))
  if (!grid.children.length) grid.append(emptyState('No matching content.'))
}

function renderCreate() {
  const grid = clear($('#draftGrid'))
  const drafts = state.boot.home.drafts
  if (!drafts.length) {
    grid.append(emptyState('Your editable character and story drafts will appear here.'))
    return
  }
  grid.append(...drafts.map(draft => el('article', { class: 'draft-card' },
    el('div', {}, el('small', { text: draft.type === 'story' ? t('stories') : t('characters') }), el('h3', { text: draft.title }), el('small', { text: relativeTime(draft.updated_at, getLocale()) })),
    el('div', { class: 'draft-card-actions' },
      el('button', { class: 'secondary compact', text: t('editDraft'), on: { click: () => openDraftEditor(draft.id) } }),
      el('button', { class: 'compact', text: t('publish'), on: { click: () => publishDraft(draft.id, false) } }),
    ),
  )))
}

function renderSettings() {
  const profile = state.boot.user_profile
  const form = $('#profileForm')
  form.elements.name.value = profile.name || ''
  form.elements.bio.value = profile.bio || ''
  form.elements.locale.value = profile.locale || getLocale()
  const personaSelect = form.elements.default_persona_id
  clear(personaSelect).append(el('option', { value: '', text: '—' }), ...state.boot.personas.map(persona => el('option', { value: persona.id, text: persona.name })))
  personaSelect.value = profile.default_persona_id || ''

  const connectionList = clear($('#connectionList'))
  connectionList.append(...state.boot.provider_connections.map(connection => el('div', { class: 'settings-row' },
    el('div', {}, el('strong', { text: connection.label }), el('small', { text: connection.provider_id === 'mock' ? 'Ready to use · included with Tavern' : `${connection.provider_label || connection.provider_id} · Ready` })),
    el('div', { class: 'settings-row-actions' }, connection.provider_id !== 'mock' ? el('button', { class: 'danger compact', text: 'Remove', on: { click: () => removeConnection(connection.id) } }) : null),
  )))
  const accounts = clear($('#accountConnectionList'))
  accounts.append(...state.boot.account_connections.map(account => el('div', { class: 'settings-row' },
    el('div', {}, el('strong', { text: account.label }), el('small', { text: 'Connected account' })),
    el('button', { class: 'danger compact', text: 'Disconnect', on: { click: () => disconnectAccount(account.id) } }),
  )))

  const extensionList = clear($('#extensionList'))
  extensionList.append(...state.boot.extensions.map(extension => el('div', { class: 'settings-row' },
    el('div', {}, el('strong', { text: extension.name }), el('small', { text: `${extension.description || 'Adds reusable creative choices.'} · v${extension.version}` })),
    el('div', { class: 'settings-row-actions' },
      extension.source !== 'builtin' ? el('button', { class: 'secondary compact', text: t('downloadAddon'), on: { click: async () => downloadJson(await api(`/api/extensions/${encodeURIComponent(extension.id)}/export`), `${extension.slug}.tavern-extension.json`) } }) : null,
      extension.source !== 'builtin' ? el('button', { class: 'secondary compact', text: extension.enabled ? 'Disable' : 'Enable', on: { click: () => toggleExtension(extension.id, !extension.enabled) } }) : null,
      extension.source !== 'builtin' ? el('button', { class: 'danger compact', text: 'Remove', on: { click: () => removeExtension(extension.id) } }) : null,
    ),
  )))
}

function renderAll() {
  renderHome()
  renderChats()
  renderLibrary()
  renderCreate()
  renderSettings()
}

async function openCharacterProfile(characterId) {
  const character = await api(`/api/characters/${encodeURIComponent(characterId)}`)
  const recent = state.boot.home.continue.find(item => item.cast?.some(member => member.id === character.id) && !item.story_id)
  const fav = favoriteSet().has(`character:${character.id}`)
  const content = el('div', {},
    el('div', { class: 'profile-hero' }, avatar(character, 'xl'), el('div', {}, el('h2', { text: character.name }), el('p', { text: character.description }), el('div', { class: 'card-meta' }, ...(character.tags || []).map(tag => el('span', { class: 'tag', text: tag }))))),
    el('div', { class: 'detail-grid' },
      el('div', { class: 'detail-box' }, el('h3', { text: 'Personality' }), el('p', { text: character.personality || 'Still to be discovered.' })),
      el('div', { class: 'detail-box' }, el('h3', { text: 'First meeting' }), el('p', { text: character.scenario || character.first_message })),
    ),
    el('div', { class: 'profile-actions' },
      recent ? el('button', { text: t('continueChat'), on: { click: () => { closeModal(); openConversation(recent.id) } } }) : null,
      el('button', { class: recent ? 'secondary' : '', text: t('startChat'), on: { click: () => startCharacterChat(character) } }),
      el('button', { class: 'secondary', text: fav ? t('unfavorite') : t('favorite'), on: { click: () => toggleFavorite('character', character.id, !fav, () => openCharacterProfile(character.id)) } }),
      el('button', { class: 'secondary', text: t('share'), on: { click: () => openShare('character', character.id, character.name) } }),
    ),
  )
  openModal(character.name, content)
}

function personaOptions(selectedId = '') {
  return state.boot.personas.map(persona => el('option', { value: persona.id, text: persona.name, selected: persona.id === selectedId }))
}

function startCharacterChat(character) {
  const form = el('form', { class: 'friendly-form' },
    el('p', { text: character.first_message || character.scenario }),
    el('label', {}, el('span', { text: t('choosePersona') }), el('select', { name: 'persona_id' }, ...personaOptions(currentDefaultPersona()?.id))),
    el('button', { type: 'submit', text: t('startChat') }),
  )
  form.addEventListener('submit', async event => {
    event.preventDefault()
    const values = formObject(form)
    const conversation = await api('/api/conversations', { method: 'POST', body: JSON.stringify({ title: character.name, character_ids: [character.id], persona_id: values.persona_id || null, thinking_intensity: 'auto' }) })
    closeModal()
    await refresh()
    await openConversation(conversation.id)
  })
  openModal(`${t('startChat')}: ${character.name}`, form)
}

async function openStoryDetail(storyId) {
  const story = await api(`/api/stories/${encodeURIComponent(storyId)}`)
  const latest = story.playthroughs?.[0]
  const fav = favoriteSet().has(`story:${story.id}`)
  const content = el('div', {},
    el('div', { class: 'profile-hero' }, castStack(story.cast, 'lg'), el('div', {}, el('h2', { text: story.title }), el('p', { text: story.hook || story.summary }), el('div', { class: 'card-meta' }, el('span', { class: 'tag', text: story.genre }), el('span', { class: 'tag', text: `${story.cast.length} cast` })))),
    el('div', { class: 'detail-box' }, el('h3', { text: 'Premise' }), el('p', { text: story.premise })),
    el('h3', { text: t('cast') }),
    el('div', { class: 'cast-preview' }, ...story.cast.map(member => el('div', { class: 'cast-chip' }, avatar(member.character, 'sm'), el('span', { text: `${member.character.name} · ${member.role}` })))),
    story.content_warnings?.length ? el('div', { class: 'detail-box' }, el('h3', { text: t('contentNotes') }), el('p', { text: story.content_warnings.join(' · ') })) : null,
    el('div', { class: 'profile-actions' },
      latest?.current_conversation_id ? el('button', { text: t('continue'), on: { click: () => { closeModal(); openConversation(latest.current_conversation_id) } } }) : null,
      el('button', { class: latest ? 'secondary' : '', text: latest ? t('newPlaythrough') : t('beginStory'), on: { click: () => startStory(story) } }),
      el('button', { class: 'secondary', text: fav ? t('unfavorite') : t('favorite'), on: { click: () => toggleFavorite('story', story.id, !fav, () => openStoryDetail(story.id)) } }),
      el('button', { class: 'secondary', text: 'Edit Story source', on: { click: () => openStorySourceEditor(story) } }),
      el('button', { class: 'secondary', text: t('share'), on: { click: () => openShare('story', story.id, story.title) } }),
      el('button', { class: 'secondary', text: t('saveAsTemplate'), on: { click: () => saveStoryAsTemplate(story) } }),
    ),
  )
  openModal(story.title, content, { wide: true })
}

async function openStorySourceEditor(story) {
  const loaded = await api(`/api/story-sources/${encodeURIComponent(story.id)}`)
  const source = el('textarea', { class: 'source-editor', rows: 28, spellcheck: 'false', value: JSON.stringify(loaded.source, null, 2) })
  const parse = () => {
    try { return JSON.parse(source.value) } catch (error) { throw new Error(`Story source is not valid JSON: ${error.message}`) }
  }
  const form = el('form', { class: 'friendly-form source-editor-form' },
    el('div', { class: 'source-status' },
      el('div', {}, el('strong', { text: `${loaded.source.format}/v${loaded.source.format_version}` }), el('small', { text: `${loaded.binding.kind} source · ${loaded.binding.path}` })),
      el('span', { class: 'status-pill active', text: 'Canonical source' }),
    ),
    el('p', { text: 'This versioned file is the editable Story source. Saving validates character and scene references, writes the bound files, then rebuilds the SQLite runtime projection.' }),
    el('label', {}, el('span', { text: 'Story source JSON' }), source),
    el('div', { class: 'profile-actions' },
      el('button', { type: 'submit', text: 'Validate and save source' }),
      el('button', { type: 'button', class: 'secondary', text: 'Download editable source', on: { click: () => downloadJson(parse(), `${loaded.source.story_key}.story.tavern.json`) } }),
    ),
    el('p', { class: 'microcopy', text: 'Character keys and story_key are stable file identifiers, not local database IDs. Conversations and playthrough state stay separate.' }),
  )
  form.addEventListener('submit', async event => {
    event.preventDefault()
    const saved = await api(`/api/story-sources/${encodeURIComponent(story.id)}`, { method: 'PUT', body: JSON.stringify({ source: parse(), expected_digest: loaded.binding.digest }) })
    closeModal()
    await refresh()
    toast('Story source validated and saved')
    await openStoryDetail(saved.story.id)
  })
  openModal(`Edit source: ${story.title}`, form, { wide: true, autoFocus: false })
}

function saveStoryAsTemplate(story) {
  const form = el('form', { class: 'friendly-form' },
    el('p', { text: 'Save the cast balance, world rules, scene structure, and tone as a reusable starting point. You can change every detail in the next story.' }),
    el('label', {}, el('span', { text: 'Template name' }), el('input', { name: 'name', value: `${story.title} pattern`, required: true, maxlength: 120 })),
    el('label', {}, el('span', { text: 'When should this template be used?' }), el('textarea', { name: 'description', rows: 3, value: `Use this when you want a new ${story.genre || 'story'} with a similar cast dynamic and scene structure.` })),
    el('button', { type: 'submit', text: t('saveAsTemplate') }),
  )
  form.addEventListener('submit', async event => {
    event.preventDefault()
    const values = formObject(form)
    await api(`/api/extensions/from-story/${encodeURIComponent(story.id)}`, { method: 'POST', body: JSON.stringify(values) })
    closeModal()
    await refresh()
    toast(t('templateSaved'))
    showView('create')
  })
  openModal(t('saveAsTemplate'), form)
}

function startStory(story) {
  const form = el('form', { class: 'friendly-form' },
    el('div', { class: 'detail-box' }, el('h3', { text: t('storyStyle') }), el('p', { text: `${story.genre} · ${story.tone}` })),
    el('label', {}, el('span', { text: t('choosePersona') }), el('select', { name: 'persona_id' }, ...personaOptions(currentDefaultPersona()?.id))),
    el('label', {}, el('span', { text: t('playerRole') }), el('textarea', { name: 'player_role', rows: 4, value: story.player_role })),
    el('button', { type: 'submit', text: t('beginStory') }),
  )
  form.addEventListener('submit', async event => {
    event.preventDefault()
    const values = formObject(form)
    const created = await api('/api/playthroughs', { method: 'POST', body: JSON.stringify({ story_id: story.id, persona_id: values.persona_id || null, player_role: values.player_role, thinking_intensity: 'auto' }) })
    closeModal()
    await refresh()
    await openConversation(created.conversation.id)
  })
  openModal(`${t('beginStory')}: ${story.title}`, form)
}

async function openConversation(conversationId) {
  state.conversationId = conversationId
  state.conversation = await api(`/api/conversations/${encodeURIComponent(conversationId)}`)
  const view = state.conversation
  $('#activeChatTitle').textContent = view.conversation.title
  const scene = view.journal.current_scene
  $('#activeChatScene').textContent = [scene?.location, scene?.time, scene?.title].filter(Boolean).join(' · ') || (view.story?.genre || 'Persistent conversation')
  clear($('#chatCastAvatars')).append(...view.cast.slice(0, 4).map(member => avatar(member.character, 'sm')))
  updateChatModelSwitch()
  renderMessages()
  renderQuickActions()
  showView('chat', { updateHash: false })
  history.replaceState(null, '', `#chat/${encodeURIComponent(conversationId)}`)
  $('#messageInput').focus()
}

function conversationConnection(conversation = state.conversation?.conversation) {
  return state.boot?.provider_connections.find(connection => connection.id === conversation?.connection_id) ?? null
}

function accountForConnection(connection) {
  if (!connection) return null
  return state.boot.account_connections.find(account => account.metadata?.provider_id === connection.provider_id) ?? null
}

function updateChatModelSwitch() {
  const conversation = state.conversation?.conversation
  const connection = conversationConnection(conversation)
  if (!conversation) return
  $('#activeProviderName').textContent = connection?.label || t('aiService')
  $('#activeModelName').textContent = conversation.model_id || t('model')
  $('#chatModelSwitch').classList.toggle('demo', connection?.provider_id === 'mock')
  $('#chatModelSwitch').title = `${connection?.provider_label || connection?.provider_id || t('aiService')} · ${conversation.model_id || t('model')}`
}

function actorFor(actorId) {
  if (actorId === 'user') return { name: state.boot.user_profile.name || currentDefaultPersona()?.name || 'You', avatar_url: state.boot.user_profile.avatar_url || currentDefaultPersona()?.avatar_url }
  if (actorId === 'narrator') return { name: 'Narrator', narrator: true }
  return state.conversation?.cast.find(member => member.character_id === actorId)?.character || { name: 'Tavern companion' }
}

function renderMessages() {
  const list = clear($('#messageList'))
  const messages = state.conversation?.messages ?? []
  for (const [index, message] of messages.entries()) {
    const actor = actorFor(message.actor_id)
    const classes = ['message', message.role === 'user' ? 'user' : '', actor.narrator ? 'narrator' : ''].filter(Boolean).join(' ')
    const body = el('div', { class: 'message-body' })
    if (message.role !== 'user' && !actor.narrator) body.append(el('div', { class: 'message-name' }, el('strong', { text: actor.name })))
    const bubble = el('div', { class: 'message-bubble' })
    bubble.append(safeMarkdown(message.content))
    body.append(bubble)
    const actions = el('div', { class: 'message-actions' },
      el('button', { text: t('copy'), on: { click: () => copyText(message.content) } }),
      message.role === 'user' ? el('button', { text: t('edit'), on: { click: () => editUserMessage(index) } }) : null,
      message.role === 'assistant' ? el('button', { text: t('regenerate'), on: { click: () => regenerateFrom(index) } }) : null,
      el('button', { text: 'What if…', on: { click: () => createTimelineFrom(message.event_id) } }),
    )
    body.append(actions)
    list.append(el('article', { class: classes }, message.role !== 'user' && !actor.narrator ? avatar(actor, 'md') : null, body))
  }
  requestAnimationFrame(() => { list.scrollTop = list.scrollHeight })
}

function renderQuickActions() {
  const node = clear($('#quickActions'))
  const actions = state.boot.contributions.quick_actions || []
  node.append(...actions.slice(0, 12).map(action => el('button', { text: action.label, title: action.prompt, on: { click: () => applyQuickAction(action) } })))
}

function applyQuickAction(action) {
  const input = $('#messageInput')
  if (action.id === 'continue') {
    input.value = action.prompt
    sendCurrentMessage()
  } else {
    input.value = `${input.value}${input.value ? '\n' : ''}${action.prompt}`
    input.focus()
  }
}

async function sendCurrentMessage() {
  const input = $('#messageInput')
  const content = input.value.trim()
  if (!content || !state.conversationId || state.streaming) return
  input.value = ''
  state.streaming = true
  $('#sendButton').textContent = t('stop')
  $('#typing').classList.remove('hidden')
  const optimistic = {
    event_id: `local-${Date.now()}`, role: 'user', actor_id: 'user', content, metadata: {}, created_at: new Date().toISOString(),
  }
  state.conversation.messages.push(optimistic)
  renderMessages()
  try {
    await streamTurn(state.conversationId, content, { onEvent(event, data) {
      if (event === 'message.completed') {
        state.conversation.messages.push({ event_id: `stream-${crypto.randomUUID()}`, role: 'assistant', actor_id: data.character_id, content: data.content, metadata: {}, created_at: new Date().toISOString() })
        renderMessages()
      }
    } })
    await refresh({ preserveView: false })
    await openConversation(state.conversationId)
  } catch (error) {
    const message = error.code === 'model_output_truncated'
      ? t('modelOutputTruncated')
      : error.code === 'invalid_model_output'
        ? t('invalidModelOutput')
        : error.message
    toast(message, 7000)
    state.conversation.messages = state.conversation.messages.filter(message => message !== optimistic)
    input.value = content
    renderMessages()
  } finally {
    state.streaming = false
    $('#typing').classList.add('hidden')
    $('#sendButton').textContent = t('send')
  }
}

async function editUserMessage(index) {
  const message = state.conversation.messages[index]
  const form = el('form', { class: 'friendly-form' }, el('label', {}, el('span', { text: 'Edit your message' }), el('textarea', { name: 'content', rows: 6, value: message.content })), el('button', { type: 'submit', text: 'Continue from edited message' }))
  form.addEventListener('submit', async event => {
    event.preventDefault()
    const previous = [...state.conversation.messages.slice(0, index)].reverse().find(item => item.event_id && !String(item.event_id).startsWith('local-'))
    const values = formObject(form)
    const fork = await api(`/api/conversations/${encodeURIComponent(state.conversationId)}/branches`, { method: 'POST', body: JSON.stringify({ fork_event_id: previous?.event_id ?? null, label: `Edited: ${values.content.slice(0, 45)}` }) })
    closeModal()
    await openConversation(fork.conversation.id)
    $('#messageInput').value = values.content
    await sendCurrentMessage()
  })
  openModal(t('edit'), form)
}

async function regenerateFrom(index) {
  const userIndex = [...state.conversation.messages.slice(0, index)].map((item, idx) => ({ item, idx })).reverse().find(entry => entry.item.role === 'user')?.idx
  if (userIndex === undefined) return
  const userMessage = state.conversation.messages[userIndex]
  const previous = [...state.conversation.messages.slice(0, userIndex)].reverse().find(item => item.event_id)
  const fork = await api(`/api/conversations/${encodeURIComponent(state.conversationId)}/branches`, { method: 'POST', body: JSON.stringify({ fork_event_id: previous?.event_id ?? null, label: `Alternative reply to: ${userMessage.content.slice(0, 40)}` }) })
  await openConversation(fork.conversation.id)
  $('#messageInput').value = userMessage.content
  await sendCurrentMessage()
}

async function createTimelineFrom(eventId = null) {
  const label = window.prompt('Name this “what if” timeline:', 'What if…')
  if (!label) return
  await api(`/api/conversations/${encodeURIComponent(state.conversationId)}/branches`, { method: 'POST', body: JSON.stringify({ fork_event_id: eventId, label }) })
  await openConversation(state.conversationId)
  toast(t('created'))
}

function openCastDrawer() {
  const body = el('div', {})
  for (const member of state.conversation.cast) {
    body.append(el('div', { class: 'cast-row' },
      avatar(member.character, 'md'),
      el('div', {}, el('strong', { text: member.character.name }), el('small', { text: member.role })),
      el('div', { class: 'cast-controls' },
        el('button', { class: `secondary compact ${member.spotlight ? 'active' : ''}`, text: t('spotlight'), on: { click: () => updateCast(member.character_id, { spotlight: !member.spotlight }) } }),
        el('button', { class: `secondary compact ${member.muted ? 'danger' : ''}`, text: member.muted ? t('inviteBack') : t('quiet'), on: { click: () => updateCast(member.character_id, { muted: !member.muted }) } }),
      ),
    ))
  }
  openDrawer(t('cast'), body)
}

async function updateCast(characterId, patch) {
  await api(`/api/conversations/${encodeURIComponent(state.conversationId)}/cast/${encodeURIComponent(characterId)}`, { method: 'PATCH', body: JSON.stringify(patch) })
  await openConversation(state.conversationId)
  openCastDrawer()
}

function journalSection(title, content) {
  if (content === null || content === undefined || (Array.isArray(content) && !content.length)) return null
  const section = el('section', { class: 'drawer-section' }, el('h3', { text: title }))
  if (typeof content === 'string') section.append(el('div', { class: 'journal-card' }, el('p', { text: content })))
  else if (Array.isArray(content)) section.append(...content.map(item => el('div', { class: 'journal-card' }, el('p', { text: typeof item === 'string' ? item : item.content || item.title || JSON.stringify(item) }))))
  else section.append(el('div', { class: 'journal-card' }, el('p', { text: Object.entries(content).map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`).join('\n') })))
  return section
}

function openJournalDrawer() {
  const journal = state.conversation.journal
  const body = el('div', {},
    journal.current_scene ? el('section', { class: 'drawer-section' }, el('h3', { text: t('currentScene') }), el('div', { class: 'journal-card' }, el('h4', { text: journal.current_scene.title || journal.current_scene.location || 'Current scene' }), el('p', { text: [journal.current_scene.location, journal.current_scene.time].filter(Boolean).join(' · ') }))) : null,
    journalSection(t('recap'), journal.recap),
    journalSection(t('openThreads'), journal.open_threads),
    el('section', { class: 'drawer-section' }, el('h3', { text: t('relationships') }), ...journal.relationships.map(item => el('div', { class: 'cast-row' }, avatar(item, 'sm'), el('div', {}, el('strong', { text: item.name }), el('small', { text: item.label }))))),
    journalSection(t('knownFacts'), journal.known_facts),
  )
  openDrawer(t('journal'), body)
}

async function openModelControlsDrawer(initialPresetId = '') {
  const conversation = state.conversation.conversation
  const localText = (zh, en) => getLocale() === 'zh' ? zh : en
  const connections = state.boot.provider_connections.filter(connection => connection.enabled)
  const currentConnection = conversationConnection(conversation)
  const connectionSelect = el('select', { name: 'connection_id', required: true }, ...connections.map(connection =>
    el('option', { value: connection.id, text: `${connection.label}${connection.provider_id === 'mock' ? ' · Demo' : ''}` }),
  ))
  connectionSelect.value = currentConnection?.id || connections[0]?.id || ''

  const modelList = el('datalist', { id: 'availableModelIds' })
  const modelInput = el('input', { name: 'model_id', value: conversation.model_id, required: true, autocomplete: 'off', placeholder: 'Model ID' })
  modelInput.setAttribute('list', 'availableModelIds')
  const modelStatus = el('small', { class: 'control-status', text: t('loadingModels') })
  const refreshModels = el('button', { type: 'button', class: 'secondary compact', text: t('loadModels') })

  const presetSelect = el('select', { name: 'preset_id' },
    el('option', { value: '', text: t('currentCustomSettings') }),
    ...state.boot.generation_presets.map(preset => el('option', { value: preset.id, text: `${preset.name}${preset.builtin ? '' : ` · ${t('customPreset')}`}` })),
  )
  presetSelect.value = initialPresetId
  const presetSummary = el('div', { class: 'preset-summary' })
  const savePreset = el('button', { type: 'button', class: 'secondary compact', text: t('savePreset') })
  const updatePreset = el('button', { type: 'button', class: 'secondary compact hidden', text: localText('更新预设', 'Update preset') })
  const importPreset = el('button', { type: 'button', class: 'secondary compact', text: localText('导入 SillyTavern', 'Import SillyTavern') })
  const removePreset = el('button', { type: 'button', class: 'danger compact hidden', text: t('removePreset') })
  const presetFileInput = el('input', { type: 'file', accept: 'application/json,.json,.settings', hidden: true })

  const temperatureValue = el('output', { text: String(conversation.generation.temperature) })
  const temperatureInput = el('input', { name: 'temperature', type: 'range', min: '0', max: '2', step: '0.01', value: String(conversation.generation.temperature) })
  const topPValue = el('output', { text: String(conversation.generation.top_p) })
  const topPInput = el('input', { name: 'top_p', type: 'range', min: '0.01', max: '1', step: '0.01', value: String(conversation.generation.top_p) })
  const stopSequencesInput = el('textarea', { name: 'stop_sequences', rows: 3, maxlength: 3400, value: (conversation.generation.stop_sequences || []).join('\n'), placeholder: localText('每行一个停止序列', 'One stop sequence per line') })
  const providerOptionsInput = el('textarea', { name: 'provider_options', rows: 6, maxlength: 20000, spellcheck: false, value: Object.keys(conversation.generation.provider_options || {}).length ? JSON.stringify(conversation.generation.provider_options, null, 2) : '', placeholder: '{\n  "provider_specific_option": true\n}' })

  const numericField = (name, label, { min, max, step, value, hint }) => el('label', { class: 'field compact-field' },
    el('span', { text: label }),
    el('input', { name, type: 'number', min, max, step, value }),
    hint ? el('small', { text: hint }) : null,
  )

  const form = el('form', { class: 'friendly-form' },
    el('section', { class: 'control-section' },
      el('div', { class: 'control-section-heading' }, el('div', {}, el('p', { class: 'eyebrow', text: t('aiService') }), el('h3', { text: t('connectionModel') })), el('span', { class: `connection-state ${currentConnection?.provider_id === 'mock' ? 'demo' : ''}`, text: currentConnection?.provider_id === 'mock' ? t('demo') : t('connected') })),
      el('label', { class: 'field' }, el('span', { text: t('aiService') }), connectionSelect),
      el('label', { class: 'field' }, el('span', { text: t('model') }), el('div', { class: 'model-input-row' }, modelInput, refreshModels), modelList, modelStatus),
      el('button', { type: 'button', class: 'text-button control-link', text: `＋ ${t('addAiService')}`, on: { click: () => { closeDrawer(); openProviderForm() } } }),
    ),
    el('section', { class: 'control-section' },
      el('div', { class: 'control-section-heading' }, el('div', {}, el('p', { class: 'eyebrow', text: t('responsePreset') }), el('h3', { text: t('reusableSetup') }))),
      el('label', { class: 'field' }, presetSelect),
      presetSummary,
      presetFileInput,
      el('div', { class: 'inline-actions' }, savePreset, updatePreset, importPreset, removePreset),
    ),
    el('section', { class: 'control-section' },
      el('div', { class: 'control-section-heading' }, el('div', {}, el('p', { class: 'eyebrow', text: t('aiInput') }), el('h3', { text: t('modelReceives') }))),
      el('label', { class: 'field' }, el('span', { text: t('customInstructions') }), el('textarea', { name: 'custom_instructions', rows: 6, maxlength: 20000, value: conversation.prompt.custom_instructions, placeholder: getLocale() === 'zh' ? '例如：保持对白克制，场景描写简短。' : 'For example: Keep dialogue understated and use short scene descriptions.' }), el('small', { text: t('instructionHint') })),
      el('label', { class: 'field' }, el('span', { text: t('historyMessages') }), el('input', { name: 'history_messages', type: 'number', min: 0, max: 200, step: 1, value: conversation.prompt.history_messages }), el('small', { text: t('historyHint') })),
      el('div', { class: 'prompt-stack' },
        el('span', { text: getLocale() === 'zh' ? '核心规则 · 受保护' : 'Core rules · protected' }), el('span', { text: getLocale() === 'zh' ? '角色与故事' : 'Character & story' }), el('span', { text: getLocale() === 'zh' ? '记忆与状态' : 'Memory & state' }), el('span', { text: getLocale() === 'zh' ? '你的指令' : 'Your instructions' }), el('span', { text: getLocale() === 'zh' ? '聊天历史' : 'Chat history' }),
      ),
    ),
    el('section', { class: 'control-section' },
      el('div', { class: 'control-section-heading' }, el('div', {}, el('p', { class: 'eyebrow', text: localText('推理与回复', 'Reasoning & reply') }), el('h3', { text: localText('模型如何思考和回应', 'How the model thinks and responds') }))),
      el('div', { class: 'form-row response-controls' },
        el('label', { class: 'field' }, el('span', { text: t('thinking') }), el('select', { name: 'thinking_intensity' },
          el('option', { value: 'auto', text: t('automatic') }), el('option', { value: 'none', text: localText('关闭', 'None') }), el('option', { value: 'low', text: t('fast') }), el('option', { value: 'medium', text: t('balanced') }), el('option', { value: 'high', text: t('thoughtful') }), el('option', { value: 'max', text: t('deepest') }),
        ), el('small', { text: localText('预设会保存此项，并映射到所选模型的原生推理参数。', 'Saved with the preset and mapped to the selected model’s native reasoning control.') })),
        el('label', { class: 'field' }, el('span', { text: t('responseLength') }), el('select', { name: 'response_length' }, el('option', { value: 'short', text: t('short') }), el('option', { value: 'natural', text: t('natural') }), el('option', { value: 'detailed', text: t('detailed') }))),
        el('label', { class: 'field' }, el('span', { text: t('initiative') }), el('select', { name: 'initiative' }, el('option', { value: 'reactive', text: t('reactive') }), el('option', { value: 'balanced', text: t('balanced') }), el('option', { value: 'proactive', text: t('proactive') }))),
        el('label', { class: 'field' }, el('span', { text: t('pacing') }), el('select', { name: 'pacing' }, el('option', { value: 'focused', text: t('focused') }), el('option', { value: 'natural', text: t('natural') }), el('option', { value: 'ensemble', text: t('ensemble') }))),
      ),
    ),
    el('details', { class: 'control-section control-details' },
      el('summary', {}, el('div', {}, el('p', { class: 'eyebrow', text: t('sampling') }), el('h3', { text: localText('高级采样参数', 'Advanced sampling') })), el('span', { text: '›' })),
      el('div', { class: 'control-details-body' },
        el('div', { class: 'range-field' }, el('div', {}, el('span', { text: t('temperature') }), temperatureValue), temperatureInput, el('small', { text: t('temperatureHint') })),
        el('div', { class: 'range-field' }, el('div', {}, el('span', { text: t('topP') }), topPValue), topPInput, el('small', { text: t('topPHint') })),
        el('div', { class: 'parameter-grid' },
          numericField('frequency_penalty', localText('频率惩罚', 'Frequency penalty'), { min: -2, max: 2, step: .05, value: conversation.generation.frequency_penalty, hint: localText('0 为关闭', '0 disables') }),
          numericField('presence_penalty', localText('存在惩罚', 'Presence penalty'), { min: -2, max: 2, step: .05, value: conversation.generation.presence_penalty, hint: localText('0 为关闭', '0 disables') }),
          numericField('top_k', 'Top K', { min: 0, max: 500, step: 1, value: conversation.generation.top_k, hint: localText('0 为关闭', '0 disables') }),
          numericField('min_p', 'Min P', { min: 0, max: 1, step: .01, value: conversation.generation.min_p, hint: localText('0 为关闭', '0 disables') }),
          numericField('repetition_penalty', localText('重复惩罚', 'Repetition penalty'), { min: .01, max: 2, step: .01, value: conversation.generation.repetition_penalty, hint: localText('1 为关闭', '1 disables') }),
          numericField('seed', localText('随机种子', 'Seed'), { min: 0, max: 2147483647, step: 1, value: conversation.generation.seed ?? '', hint: localText('留空为随机', 'Blank is random') }),
        ),
        el('label', { class: 'field' }, el('span', { text: localText('停止序列', 'Stop sequences') }), stopSequencesInput, el('small', { text: localText('每行一个，最多 16 个。部分序列可能提前结束结构化回复。', 'One per line, up to 16. Some sequences may end a structured reply early.') })),
        el('p', { class: 'microcopy output-limit-note', text: t('outputLimitHint') }),
      ),
    ),
    el('details', { class: 'control-section control-details provider-options-section' },
      el('summary', {}, el('div', {}, el('p', { class: 'eyebrow', text: localText('模型专属', 'Provider-specific') }), el('h3', { text: localText('Provider JSON 参数', 'Provider JSON options') })), el('span', { text: '›' })),
      el('div', { class: 'control-details-body' },
        el('p', { class: 'microcopy', text: localText('参考 OpenCode 的覆盖层设计：这里的 JSON 会随预设保存，并先于 Tavern 受保护字段合并。不同模型可能忽略或拒绝未知参数。', 'Following OpenCode’s overlay design, this JSON is saved with the preset and merged before Tavern’s protected fields. Models may ignore or reject unknown options.') }),
        el('label', { class: 'field' }, providerOptionsInput, el('small', { text: localText('不能覆盖模型、消息、思考、输出格式或 Token 上限。', 'Cannot override model, messages, reasoning, output format, or token limits.') })),
      ),
    ),
    el('div', { class: 'control-save-bar' }, el('small', { text: t('changesNextReply') }), el('button', { type: 'submit', text: t('save') })),
  )

  form.elements.thinking_intensity.value = conversation.thinking_intensity
  form.elements.response_length.value = conversation.generation.response_length || 'natural'
  form.elements.initiative.value = conversation.generation.initiative || 'balanced'
  form.elements.pacing.value = conversation.generation.pacing || 'natural'

  const settingsFromForm = () => {
    let providerOptions = {}
    const providerSource = form.elements.provider_options.value.trim()
    if (providerSource) {
      try { providerOptions = JSON.parse(providerSource) } catch { throw new Error(localText('Provider 参数必须是有效 JSON。', 'Provider options must be valid JSON.')) }
      if (!providerOptions || typeof providerOptions !== 'object' || Array.isArray(providerOptions)) throw new Error(localText('Provider 参数必须是一个 JSON 对象。', 'Provider options must be a JSON object.'))
    }
    return {
      thinking_intensity: form.elements.thinking_intensity.value,
      generation: {
        response_length: form.elements.response_length.value,
        initiative: form.elements.initiative.value,
        pacing: form.elements.pacing.value,
        temperature: Number(form.elements.temperature.value),
        top_p: Number(form.elements.top_p.value),
        frequency_penalty: Number(form.elements.frequency_penalty.value),
        presence_penalty: Number(form.elements.presence_penalty.value),
        top_k: Number(form.elements.top_k.value),
        min_p: Number(form.elements.min_p.value),
        repetition_penalty: Number(form.elements.repetition_penalty.value),
        seed: form.elements.seed.value === '' ? null : Number(form.elements.seed.value),
        stop_sequences: form.elements.stop_sequences.value.split(/\r?\n/).map(item => item.trim()).filter(Boolean),
        provider_options: providerOptions,
      },
      prompt: {
        custom_instructions: form.elements.custom_instructions.value,
        history_messages: Number(form.elements.history_messages.value),
      },
    }
  }

  const applySettings = settings => {
    form.elements.thinking_intensity.value = settings.thinking_intensity
    for (const [name, value] of Object.entries(settings.generation)) {
      if (!form.elements[name]) continue
      if (name === 'stop_sequences') form.elements[name].value = (value || []).join('\n')
      else if (name === 'provider_options') form.elements[name].value = Object.keys(value || {}).length ? JSON.stringify(value, null, 2) : ''
      else form.elements[name].value = value ?? ''
    }
    for (const [name, value] of Object.entries(settings.prompt)) if (form.elements[name]) form.elements[name].value = value
    temperatureValue.textContent = Number(form.elements.temperature.value).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
    topPValue.textContent = Number(form.elements.top_p.value).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
    form.classList.remove('preset-applied')
    requestAnimationFrame(() => form.classList.add('preset-applied'))
  }

  const updatePresetActions = () => {
    const preset = state.boot.generation_presets.find(item => item.id === presetSelect.value)
    removePreset.classList.toggle('hidden', !preset || preset.builtin)
    updatePreset.classList.toggle('hidden', !preset || preset.builtin)
    const settings = preset?.settings
    const badges = settings ? [
      `${t('thinking')}: ${settings.thinking_intensity}`,
      `${t('temperature')}: ${settings.generation.temperature}`,
      `Top P: ${settings.generation.top_p}`,
      `${t('historyMessages')}: ${settings.prompt.history_messages}`,
      Object.keys(settings.generation.provider_options || {}).length ? localText(`${Object.keys(settings.generation.provider_options).length} 个专属参数`, `${Object.keys(settings.generation.provider_options).length} provider option(s)`) : null,
    ].filter(Boolean) : []
    const summaryNodes = [el('small', { class: 'control-status', text: preset?.description || t('choosePresetHint') })]
    if (badges.length) summaryNodes.push(el('div', { class: 'preset-badges' }, ...badges.map(text => el('span', { text }))))
    clear(presetSummary).append(...summaryNodes)
  }

  const loadModels = async ({ refresh = false, chooseDefault = false } = {}) => {
    const connection = state.boot.provider_connections.find(item => item.id === connectionSelect.value)
    if (!connection) return
    modelStatus.textContent = t('loadingModels')
    refreshModels.disabled = true
    clear(modelList)
    try {
      const account = connection.provider_id === 'openrouter' && !connection.has_api_key ? accountForConnection(connection) : null
      const query = new URLSearchParams()
      if (account) query.set('account_connection_id', account.id)
      if (refresh) query.set('refresh', 'true')
      const result = await api(`/api/provider-connections/${encodeURIComponent(connection.id)}/models${query.size ? `?${query}` : ''}`)
      modelList.append(...result.models.map(model => el('option', { value: model.id, label: model.name || model.id })))
      if (chooseDefault || !modelInput.value) modelInput.value = connection.default_model || result.models[0]?.id || ''
      modelStatus.textContent = result.models.length
        ? getLocale() === 'zh'
          ? `可用模型 ${result.models.length} 个${result.cached ? ' · 已缓存' : ''}；也可以直接输入准确的模型 ID。`
          : `${result.models.length} models available${result.cached ? ' · cached' : ''}. You can also type an exact model ID.`
        : getLocale() === 'zh' ? '该服务未提供模型列表，请输入准确的模型 ID。' : 'This service does not publish a model list. Type the exact model ID.'
    } catch (error) {
      if (chooseDefault) modelInput.value = connection.default_model || ''
      modelStatus.textContent = getLocale() === 'zh' ? `无法加载模型列表：${error.message}。仍可手动输入模型 ID。` : `Could not load the model list: ${error.message}. You can still type an exact model ID.`
    } finally {
      refreshModels.disabled = false
    }
  }

  const markCustom = () => { presetSelect.value = ''; updatePresetActions() }
  temperatureInput.addEventListener('input', () => { temperatureValue.textContent = Number(temperatureInput.value).toFixed(2).replace(/0+$/, '').replace(/\.$/, ''); markCustom() })
  topPInput.addEventListener('input', () => { topPValue.textContent = Number(topPInput.value).toFixed(2).replace(/0+$/, '').replace(/\.$/, ''); markCustom() })
  const presetSettingNames = new Set(['thinking_intensity', 'response_length', 'initiative', 'pacing', 'frequency_penalty', 'presence_penalty', 'top_k', 'min_p', 'repetition_penalty', 'seed', 'stop_sequences', 'provider_options', 'custom_instructions', 'history_messages'])
  form.addEventListener('input', event => { if (presetSettingNames.has(event.target.name)) markCustom() })
  connectionSelect.addEventListener('change', () => loadModels({ chooseDefault: true }))
  refreshModels.addEventListener('click', () => loadModels({ refresh: true }))
  presetSelect.addEventListener('change', () => {
    const preset = state.boot.generation_presets.find(item => item.id === presetSelect.value)
    if (preset) applySettings(preset.settings)
    updatePresetActions()
  })
  savePreset.addEventListener('click', () => {
    const presetForm = el('form', { class: 'friendly-form' },
      el('p', { text: 'Save the current instructions, sampling, response behavior, and context window for reuse in any conversation.' }),
      el('label', {}, el('span', { text: t('presetName') }), el('input', { name: 'name', required: true, maxlength: 120, placeholder: getLocale() === 'zh' ? '我的角色扮演预设' : 'My roleplay preset' })),
      el('label', {}, el('span', { text: t('presetDescription') }), el('textarea', { name: 'description', rows: 3, maxlength: 1000, placeholder: getLocale() === 'zh' ? '这个预设适合在什么时候使用？' : 'When should this preset be used?' })),
      el('button', { type: 'submit', text: t('savePreset') }),
    )
    presetForm.addEventListener('submit', async event => {
      event.preventDefault()
      try {
        const values = formObject(presetForm)
        const created = await api('/api/generation-presets', { method: 'POST', body: JSON.stringify({ ...values, settings: settingsFromForm() }) })
        closeModal()
        await refresh()
        await openConversation(conversation.id)
        await openModelControlsDrawer(created.id)
        toast(t('saved'))
      } catch (error) { toast(error.message, 7000) }
    })
    openModal(t('savePreset'), presetForm)
  })

  updatePreset.addEventListener('click', async () => {
    const preset = state.boot.generation_presets.find(item => item.id === presetSelect.value)
    if (!preset || preset.builtin) return
    try {
      await api(`/api/generation-presets/${encodeURIComponent(preset.id)}`, { method: 'PATCH', body: JSON.stringify({ settings: settingsFromForm() }) })
      await refresh()
      await openConversation(conversation.id)
      await openModelControlsDrawer(preset.id)
      toast(localText('预设已更新', 'Preset updated'))
    } catch (error) { toast(error.message, 7000) }
  })

  const showPresetImportPreview = (content, file, preview) => {
    const nameInput = el('input', { name: 'name', required: true, maxlength: 120, value: preview.name })
    const descriptionInput = el('textarea', { name: 'description', rows: 3, maxlength: 1000, value: preview.description })
    const previewForm = el('form', { class: 'friendly-form preset-import-form' },
      el('div', { class: 'import-preview' },
        el('div', { class: 'import-preview-heading' }, el('div', {}, el('p', { class: 'eyebrow', text: localText('识别格式', 'Detected format') }), el('h3', { text: preview.format.replaceAll('-', ' ') })), el('span', { class: 'status-pill active', text: localText(`${preview.mapped_fields.length} 项已映射`, `${preview.mapped_fields.length} mapped`) })),
        el('div', { class: 'preset-map-list' }, ...preview.mapped_fields.map(item => el('div', { class: 'preset-map-row' }, el('code', { text: item.source }), el('span', { text: '→' }), el('strong', { text: item.target }), el('small', { text: String(item.value) })))),
        ...(preview.warnings || []).map(message => el('p', { class: 'compatibility-warning', text: message })),
        preview.ignored_count ? el('details', { class: 'advanced-details' }, el('summary', { text: localText(`${preview.ignored_count} 个字段不会导入`, `${preview.ignored_count} field(s) will not be imported`) }), el('p', { class: 'microcopy', text: preview.ignored_fields.join(', ') })) : null,
      ),
      el('label', {}, el('span', { text: t('presetName') }), nameInput),
      el('label', {}, el('span', { text: t('presetDescription') }), descriptionInput),
      el('button', { type: 'submit', text: localText('导入并应用到控件', 'Import and apply to controls') }),
    )
    previewForm.addEventListener('submit', async event => {
      event.preventDefault()
      try {
        const result = await api('/api/generation-presets/import', { method: 'POST', body: JSON.stringify({ content, source_name: file.name, name: nameInput.value, description: descriptionInput.value }) })
        state.boot.generation_presets.push(result.preset)
        presetSelect.append(el('option', { value: result.preset.id, text: `${result.preset.name} · ${t('customPreset')}` }))
        presetSelect.value = result.preset.id
        applySettings(result.preset.settings)
        updatePresetActions()
        closeModal()
        toast(localText('预设已导入并应用；点击保存使其用于下一次回复。', 'Preset imported and applied; save to use it on the next reply.'), 6000)
      } catch (error) { toast(error.message, 7000) }
    })
    openModal(localText('导入 LLM 预设', 'Import LLM preset'), previewForm, { wide: true, autoFocus: false })
  }

  importPreset.addEventListener('click', () => presetFileInput.click())
  presetFileInput.addEventListener('change', async () => {
    const file = presetFileInput.files?.[0]
    if (!file) return
    try {
      const content = await file.text()
      const preview = await api('/api/generation-presets/import/preview', { method: 'POST', body: JSON.stringify({ content, source_name: file.name }) })
      showPresetImportPreview(content, file, preview)
    } catch (error) { toast(error.message, 7000) }
    finally { presetFileInput.value = '' }
  })

  removePreset.addEventListener('click', async () => {
    const preset = state.boot.generation_presets.find(item => item.id === presetSelect.value)
    if (!preset || preset.builtin || !confirm(`Remove preset “${preset.name}”?`)) return
    await api(`/api/generation-presets/${encodeURIComponent(preset.id)}`, { method: 'DELETE' })
    await refresh()
    await openConversation(conversation.id)
    await openModelControlsDrawer()
    toast(t('saved'))
  })

  form.addEventListener('submit', async event => {
    event.preventDefault()
    try {
      const connection = state.boot.provider_connections.find(item => item.id === connectionSelect.value)
      const account = connection?.provider_id === 'openrouter' && !connection.has_api_key ? accountForConnection(connection) : null
      const settings = settingsFromForm()
      await api(`/api/conversations/${encodeURIComponent(conversation.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          connection_id: connectionSelect.value,
          account_connection_id: account?.id ?? null,
          model_id: modelInput.value.trim(),
          ...settings,
        }),
      })
      await refresh()
      await openConversation(conversation.id)
      toast(t('saved'))
      closeDrawer()
    } catch (error) { toast(error.message, 7000) }
  })

  openDrawer(t('aiControls'), form)
  updatePresetActions()
  await loadModels()
}

function openChatMoreDrawer() {
  const conversation = state.conversation.conversation
  const timelines = el('section', { class: 'drawer-section' }, el('h3', { text: t('timelines') }),
    ...state.conversation.journal.timelines.map(timeline => el('div', { class: `timeline-row ${timeline.current ? 'current' : ''}` }, el('strong', { text: timeline.label }), timeline.current ? null : el('button', { class: 'secondary compact', text: t('switchTimeline'), on: { click: () => switchTimeline(timeline.id) } }))),
    el('button', { class: 'secondary', text: t('whatIf'), on: { click: () => createTimelineFrom(state.conversation.messages.at(-1)?.event_id ?? null) } }),
  )
  const danger = el('section', { class: 'drawer-section danger-zone' },
    el('h3', { text: 'Conversation' }),
    el('p', { text: 'Deleting removes this conversation, its timelines, messages, and usage history.' }),
    el('button', { class: 'danger', text: t('deleteConversation'), on: { click: async () => {
      if (!confirm(`Delete “${conversation.title}”? This cannot be undone.`)) return
      await api(`/api/conversations/${encodeURIComponent(conversation.id)}`, { method: 'DELETE' })
      state.conversation = null
      state.conversationId = null
      closeDrawer()
      await refresh({ preserveView: false })
      showView('chats')
      toast('Conversation deleted')
    } } }),
  )
  const body = el('div', {}, timelines, danger)
  openDrawer(t('more'), body)
}

async function switchTimeline(branchId) {
  await api(`/api/conversations/${encodeURIComponent(state.conversationId)}/branches/${encodeURIComponent(branchId)}/switch`, { method: 'POST' })
  closeDrawer()
  await openConversation(state.conversationId)
}

function openWizard({ title, labels, renderStep, onNext = null, onFinish = null, finishLabel = 'Done', startAt = 0 }) {
  let index = Math.max(0, Math.min(labels.length - 1, startAt))
  let busy = false
  const root = el('div', { class: 'wizard-shell' })
  const draw = () => {
    const stepper = el('ol', { class: 'wizard-stepper', 'aria-label': 'Creation progress' }, ...labels.map((label, stepIndex) =>
      el('li', { class: `${stepIndex === index ? 'current' : ''} ${stepIndex < index ? 'complete' : ''}` }, el('span', { text: stepIndex < index ? '✓' : String(stepIndex + 1) }), el('small', { text: label })),
    ))
    const content = el('div', { class: 'wizard-content' }, renderStep(index, draw))
    const back = el('button', { type: 'button', class: 'secondary', text: index ? 'Back' : t('close'), on: { click: () => { if (index) { index -= 1; draw() } else closeModal() } } })
    const next = el('button', { type: 'button', text: index === labels.length - 1 ? finishLabel : 'Continue', on: { click: async () => {
      if (busy) return
      const invalid = root.querySelector(':invalid')
      if (invalid) { invalid.reportValidity(); return }
      busy = true
      next.disabled = true
      try {
        await onNext?.(index)
        if (index === labels.length - 1) await onFinish?.()
        else { index += 1; draw() }
      } catch (error) { toast(error.message, 7000) }
      finally { busy = false; next.disabled = false }
    } } })
    clear(root).append(stepper, content, el('div', { class: 'wizard-footer' }, back, next))
  }
  draw()
  openModal(title, root, { wide: true })
  return { draw, get step() { return index } }
}

function choiceButtons(items, selected, onSelect, { columns = 'auto' } = {}) {
  return el('div', { class: `wizard-options ${columns === 'compact' ? 'compact' : ''}` }, ...items.map(item =>
    el('button', { type: 'button', class: `wizard-option ${selected === item.value ? 'selected' : ''}`, on: { click: () => onSelect(item.value) } },
      el('strong', { text: item.label }), item.description ? el('small', { text: item.description }) : null,
    ),
  ))
}

function quickCreate(kind) {
  const templates = state.boot.contributions[`${kind}_templates`] || []
  const input = {
    template_id: templates[0]?.id || null,
    brief: '',
    name: '',
    relationship: 'companion',
    energy: 'grounded and warm',
    genre: templates[0]?.defaults?.genre || 'Mystery',
    tone: templates[0]?.defaults?.tone || 'Immersive and character-led',
    cast_size: templates[0]?.defaults?.cast_size || 3,
    player_role: '',
  }
  const labels = kind === 'story' ? ['Your idea', 'Shape the experience', 'Review'] : ['Your idea', 'Relationship', 'Review']
  let wizard
  const renderStep = (step, redraw) => {
    if (step === 0) {
      return el('div', {},
        el('div', { class: 'wizard-intro' }, el('h3', { text: kind === 'story' ? 'What should the player experience?' : 'Who would be interesting to meet?' }), el('p', { text: 'Write naturally. You do not need prompt syntax, JSON, or model instructions.' })),
        templates.length ? el('section', {}, el('label', { class: 'field-heading', text: 'Optional starting point' }), choiceButtons(templates.map(template => ({ value: template.id, label: template.name, description: template.description })), input.template_id, value => { input.template_id = value; const template = templates.find(item => item.id === value); if (kind === 'story') { input.genre = template?.defaults?.genre || input.genre; input.tone = template?.defaults?.tone || input.tone; input.cast_size = template?.defaults?.cast_size || input.cast_size } redraw() })) : null,
        el('label', {}, el('span', { text: t('yourIdea') }), el('textarea', { rows: 8, required: true, value: input.brief, placeholder: kind === 'story' ? 'Three people are trapped in a midnight train. Each knows a different reason why it cannot stop, and the player must decide whom to trust…' : 'A retired astronomer who is kind but guarded. They need help finishing one last map and gradually become a trusted friend…', on: { input: event => { input.brief = event.target.value } } })),
      )
    }
    if (step === 1 && kind === 'character') {
      const relationships = [
        { value: 'companion', label: 'Companion', description: 'A relationship that can deepen over many conversations.' },
        { value: 'rival', label: 'Rival', description: 'Challenge, friction and mutual respect.' },
        { value: 'mentor', label: 'Mentor or guide', description: 'Knowledgeable, but still a person with their own goals.' },
        { value: 'stranger', label: 'Intriguing stranger', description: 'A mystery that unfolds through conversation.' },
      ]
      const energies = [
        { value: 'grounded and warm', label: 'Warm', description: 'Attentive and emotionally grounded.' },
        { value: 'witty and lively', label: 'Lively', description: 'Playful, fast and expressive.' },
        { value: 'quiet and thoughtful', label: 'Thoughtful', description: 'Measured, reflective and subtle.' },
        { value: 'intense and challenging', label: 'Intense', description: 'Direct, driven and willing to disagree.' },
      ]
      return el('div', {},
        el('div', { class: 'wizard-intro' }, el('h3', { text: 'What kind of relationship should be possible?' }), el('p', { text: 'This guides the starting dynamic, not a fixed ending.' })),
        choiceButtons(relationships, input.relationship, value => { input.relationship = value; redraw() }),
        el('h3', { text: 'How should they feel to talk to?' }), choiceButtons(energies, input.energy, value => { input.energy = value; redraw() }),
        el('label', {}, el('span', { text: 'Name (optional)' }), el('input', { value: input.name, placeholder: 'Leave blank for a suggested name', on: { input: event => { input.name = event.target.value } } })),
      )
    }
    if (step === 1) {
      const genres = ['Mystery', 'Fantasy', 'Romance', 'Adventure', 'Science fiction', 'Slice of life']
      const tones = [
        { value: 'Immersive and character-led', label: 'Immersive', description: 'Atmospheric scenes with room to explore.' },
        { value: 'Warm and relationship-focused', label: 'Warm', description: 'Relationships and everyday moments lead.' },
        { value: 'Tense and consequential', label: 'Tense', description: 'Choices have visible pressure and cost.' },
        { value: 'Playful and surprising', label: 'Playful', description: 'Lighter pacing with character-driven surprises.' },
      ]
      return el('div', {},
        el('div', { class: 'wizard-intro' }, el('h3', { text: 'Shape the first playable version' }), el('p', { text: 'These are starting defaults. You can change every part before publishing.' })),
        el('label', {}, el('span', { text: 'Genre' }), el('select', { value: input.genre, on: { change: event => { input.genre = event.target.value } } }, ...genres.map(value => el('option', { value, text: value, selected: input.genre === value })))),
        el('h3', { text: 'Tone' }), choiceButtons(tones, input.tone, value => { input.tone = value; redraw() }),
        el('label', {}, el('span', { text: 'How many main characters?' }), el('div', { class: 'number-choices' }, ...[1,2,3,4,5].map(number => el('button', { type: 'button', class: input.cast_size === number ? 'selected' : '', text: String(number), on: { click: () => { input.cast_size = number; redraw() } } })))),
        el('label', {}, el('span', { text: 'Who is the player? (optional)' }), el('textarea', { rows: 3, value: input.player_role, placeholder: 'A newcomer, investigator, old friend, traveller… Leave blank to keep it open.', on: { input: event => { input.player_role = event.target.value } } })),
      )
    }
    const selectedTemplate = templates.find(item => item.id === input.template_id)
    return el('div', { class: 'wizard-review' },
      el('p', { class: 'eyebrow', text: 'Ready to create an editable draft' }),
      el('h3', { text: derivePreviewTitle(input.brief, kind === 'story' ? 'New story' : 'New character') }),
      el('p', { text: input.brief }),
      el('div', { class: 'review-facts' },
        selectedTemplate ? el('span', {}, el('small', { text: 'Starting point' }), el('strong', { text: selectedTemplate.name })) : null,
        kind === 'story' ? el('span', {}, el('small', { text: 'Experience' }), el('strong', { text: `${input.genre} · ${input.cast_size} character${input.cast_size === 1 ? '' : 's'}` })) : el('span', {}, el('small', { text: 'Dynamic' }), el('strong', { text: `${input.relationship} · ${input.energy}` })),
      ),
      el('p', { class: 'microcopy', text: 'The result remains a private draft. Nothing is published until you choose Publish.' }),
    )
  }
  wizard = openWizard({
    title: kind === 'story' ? t('describeStory') : t('describeCharacter'),
    labels,
    renderStep,
    finishLabel: t('generateDraft'),
    onFinish: async () => {
      const draft = await api(`/api/creator/${kind}-drafts`, { method: 'POST', body: JSON.stringify(input) })
      closeModal()
      await refresh()
      await openDraftEditor(draft.id)
    },
  })
  void wizard
}

function derivePreviewTitle(brief, fallback) {
  const first = String(brief || '').trim().split(/[.!?。！？\n]/)[0].trim()
  return first ? first.split(/\s+/).slice(0, 9).join(' ') : fallback
}

async function openDraftEditor(draftId) {
  const draft = await api(`/api/creator/drafts/${encodeURIComponent(draftId)}`)
  if (draft.type === 'character') return openCharacterDraftEditor(draft)
  return openStoryDraftEditor(draft)
}

function openCharacterDraftEditor(draft) {
  const data = structuredClone(draft.data)
  const save = () => api(`/api/creator/drafts/${encodeURIComponent(draft.id)}`, { method: 'PATCH', body: JSON.stringify({ data, title: data.name }) })
  const renderStep = (step) => {
    if (step === 0) return el('div', {},
      el('div', { class: 'wizard-intro' }, el('h3', { text: 'Introduce the character' }), el('p', { text: 'Write for a reader, not for a model. One clear paragraph is enough.' })),
      el('div', { class: 'form-row' },
        el('label', {}, el('span', { text: 'Name' }), el('input', { required: true, value: data.name, on: { input: event => { data.name = event.target.value } } })),
        el('label', {}, el('span', { text: 'Short tags' }), el('input', { value: (data.tags || []).join(', '), placeholder: 'companion, fantasy, gentle', on: { input: event => { data.tags = event.target.value.split(',').map(item => item.trim()).filter(Boolean) } } })),
      ),
      el('label', {}, el('span', { text: 'Who are they?' }), el('textarea', { required: true, rows: 5, value: data.description, on: { input: event => { data.description = event.target.value } } })),
      el('details', { class: 'friendly-details' }, el('summary', { text: 'Optional appearance and meeting situation' }),
        el('label', {}, el('span', { text: 'Appearance' }), el('textarea', { rows: 3, value: data.appearance, on: { input: event => { data.appearance = event.target.value } } })),
        el('label', {}, el('span', { text: 'How the first meeting begins' }), el('textarea', { rows: 4, value: data.scenario, on: { input: event => { data.scenario = event.target.value } } })),
      ),
    )
    if (step === 1) return el('div', {},
      el('div', { class: 'wizard-intro' }, el('h3', { text: 'Give them a recognisable voice' }), el('p', { text: 'Focus on how they behave and speak, not lists of adjectives.' })),
      el('label', {}, el('span', { text: 'Personality and behaviour' }), el('textarea', { required: true, rows: 5, value: data.personality, on: { input: event => { data.personality = event.target.value } } })),
      el('label', {}, el('span', { text: 'Speaking style' }), el('textarea', { rows: 4, value: data.speech_style, on: { input: event => { data.speech_style = event.target.value } } })),
      el('label', {}, el('span', { text: 'Their first message to the user' }), el('textarea', { required: true, rows: 6, value: data.first_message, on: { input: event => { data.first_message = event.target.value } } })),
    )
    if (step === 2) return el('div', {},
      el('div', { class: 'wizard-intro' }, el('h3', { text: 'Add depth that can unfold over time' }), el('p', { text: 'These are private authoring notes. Players will not see them unless the character reveals them naturally.' })),
      el('label', {}, el('span', { text: 'What do they want?' }), el('textarea', { rows: 5, value: (data.goals || []).join('\n'), placeholder: 'One goal per line', on: { input: event => { data.goals = lines(event.target.value) } } })),
      el('label', {}, el('span', { text: 'What are they not ready to reveal?' }), el('textarea', { rows: 5, value: (data.secrets || []).join('\n'), placeholder: 'One private fact per line', on: { input: event => { data.secrets = lines(event.target.value) } } })),
      el('label', {}, el('span', { text: 'What must the character never do?' }), el('textarea', { rows: 5, value: (data.boundaries || []).join('\n'), placeholder: 'One boundary per line', on: { input: event => { data.boundaries = lines(event.target.value) } } })),
    )
    return el('div', { class: 'wizard-review' },
      el('div', { class: 'profile-hero' }, avatar(data, 'xxl'), el('div', {}, el('p', { class: 'eyebrow', text: 'Character preview' }), el('h2', { text: data.name }), el('p', { text: data.description }))),
      el('div', { class: 'detail-grid' },
        el('div', { class: 'detail-box' }, el('h3', { text: 'Voice' }), el('p', { text: data.speech_style || data.personality })),
        el('div', { class: 'detail-box' }, el('h3', { text: 'First message' }), el('p', { text: data.first_message })),
      ),
      el('div', { class: 'profile-actions' },
        el('button', { type: 'button', class: 'secondary', text: 'Save private draft', on: { click: async () => { await save(); closeModal(); await refresh(); toast(t('saved')) } } }),
        el('button', { type: 'button', text: t('publish'), on: { click: async () => { await save(); await publishDraft(draft.id, false) } } }),
      ),
      el('p', { class: 'microcopy', text: 'Publishing adds the character to your private Library. You can share it separately afterwards.' }),
    )
  }
  openWizard({ title: `${t('editDraft')}: ${draft.title}`, labels: ['Identity', 'Voice', 'Depth', 'Preview'], renderStep, onNext: step => step < 3 ? save() : null, finishLabel: 'Close', onFinish: closeModal })
}

function openStoryDraftEditor(draft) {
  const data = structuredClone(draft.data)
  data.characters ||= []
  data.cast ||= []
  data.world_rules ||= []
  data.lore ||= []
  data.scenes ||= []
  const existingCharacters = state.boot.characters
  const save = () => api(`/api/creator/drafts/${encodeURIComponent(draft.id)}`, { method: 'PATCH', body: JSON.stringify({ data, title: data.title }) })
  const memberFor = character => {
    let member = data.cast.find(item => item.character_id === character.temporary_id || item.character_id === character.character_id)
    if (!member) {
      member = { character_id: character.temporary_id || character.character_id, role: '', public_context: '', private_context: '', metadata: {} }
      data.cast.push(member)
    }
    return member
  }
  const addCharacter = () => {
    const temporaryId = `draft-character-${crypto.randomUUID()}`
    data.characters.push({ temporary_id: temporaryId, name: `Character ${data.characters.length + 1}`, description: '', personality: '', appearance: '', scenario: data.premise, first_message: '', speech_style: '', goals: [], secrets: [], boundaries: ['Never decides the player’s thoughts, dialogue or actions.'], tags: ['story-cast'], metadata: {} })
    data.cast.push({ character_id: temporaryId, role: '', public_context: '', private_context: '', metadata: {} })
  }
  const removeCharacter = character => {
    if (data.characters.length <= 1) return toast('A playable story needs at least one character.')
    data.characters = data.characters.filter(item => item !== character)
    data.cast = data.cast.filter(item => item.character_id !== character.temporary_id && item.character_id !== character.character_id)
  }
  const validateCast = () => {
    const selected = data.characters.map(item => item.character_id).filter(Boolean)
    if (new Set(selected).size !== selected.length) throw new Error('The same existing character cannot fill two cast roles. Choose a different character or create a new one.')
  }
  const renderStep = (step, redraw) => {
    if (step === 0) return el('div', {},
      el('div', { class: 'wizard-intro' }, el('h3', { text: 'What is this story experience?' }), el('p', { text: 'A strong hook and a clear player role are enough. The rest can grow during playtesting.' })),
      el('div', { class: 'form-row' },
        el('label', {}, el('span', { text: 'Title' }), el('input', { required: true, value: data.title, on: { input: event => { data.title = event.target.value } } })),
        el('label', {}, el('span', { text: 'Genre' }), el('input', { value: data.genre, on: { input: event => { data.genre = event.target.value } } })),
      ),
      el('label', {}, el('span', { text: 'One-line invitation' }), el('textarea', { required: true, rows: 2, value: data.hook, placeholder: 'What makes someone want to enter?', on: { input: event => { data.hook = event.target.value; data.summary = event.target.value } } })),
      el('label', {}, el('span', { text: 'Premise' }), el('textarea', { required: true, rows: 6, value: data.premise, on: { input: event => { data.premise = event.target.value } } })),
      el('div', { class: 'form-row' },
        el('label', {}, el('span', { text: 'Tone' }), el('input', { value: data.tone, on: { input: event => { data.tone = event.target.value } } })),
        el('label', {}, el('span', { text: t('playerRole') }), el('input', { value: data.player_role, on: { input: event => { data.player_role = event.target.value } } })),
      ),
      el('details', { class: 'friendly-details' }, el('summary', { text: 'Optional content notes' }), el('textarea', { rows: 3, value: (data.content_warnings || []).join('\n'), placeholder: 'One theme per line, such as grief or peril', on: { input: event => { data.content_warnings = lines(event.target.value) } } })),
    )
    if (step === 1) {
      return el('div', {},
        el('div', { class: 'wizard-intro' }, el('h3', { text: 'Build the cast' }), el('p', { text: 'Each role can use an existing character or create a new one. “What only they know” stays private from the other characters and player.' })),
        el('div', { class: 'cast-editor-list' }, ...data.characters.map((character, index) => {
          const member = memberFor(character)
          const selectedId = character.character_id || ''
          const select = el('select', { on: { change: event => {
            const selected = existingCharacters.find(item => item.id === event.target.value)
            character.character_id = selected?.id || undefined
            if (selected) {
              Object.assign(character, { name: selected.name, description: selected.description, personality: selected.personality, appearance: selected.appearance, scenario: selected.scenario, first_message: selected.first_message, speech_style: selected.speech_style, goals: [], secrets: [], boundaries: [] })
            }
            member.character_id = character.temporary_id || character.character_id
            redraw()
          } } }, el('option', { value: '', text: 'Create a new character for this story' }), ...existingCharacters.map(item => el('option', { value: item.id, text: item.name, selected: selectedId === item.id })))
          return el('article', { class: 'cast-editor-card' },
            el('div', { class: 'cast-editor-heading' }, el('span', { class: 'step-number', text: String(index + 1) }), el('div', {}, el('strong', { text: character.name || `Character ${index + 1}` }), el('small', { text: member.role || 'Story role not named yet' })), el('button', { type: 'button', class: 'danger compact', text: 'Remove', on: { click: () => { removeCharacter(character); redraw() } } })),
            el('label', {}, el('span', { text: 'Use a character' }), select),
            character.character_id ? el('div', { class: 'selected-character-summary' }, avatar(character, 'md'), el('p', { text: character.description })) : el('div', { class: 'form-row' },
              el('label', {}, el('span', { text: 'Character name' }), el('input', { required: true, value: character.name, on: { input: event => { character.name = event.target.value } } })),
              el('label', {}, el('span', { text: 'Personality in a sentence' }), el('input', { value: character.personality, on: { input: event => { character.personality = event.target.value } } })),
            ),
            el('label', {}, el('span', { text: 'Their role in this story' }), el('input', { required: true, value: member.role || '', placeholder: 'Archivist, rival, old friend, witness…', on: { input: event => { member.role = event.target.value } } })),
            el('label', {}, el('span', { text: 'What everyone can know about them' }), el('textarea', { rows: 3, value: member.public_context || '', on: { input: event => { member.public_context = event.target.value } } })),
            el('label', {}, el('span', { text: 'What only this character knows' }), el('textarea', { rows: 3, value: member.private_context || '', on: { input: event => { member.private_context = event.target.value } } })),
          )
        })),
        el('button', { type: 'button', class: 'secondary', text: '+ Add another character', on: { click: () => { addCharacter(); redraw() } } }),
      )
    }
    if (step === 2) {
      const publicLore = data.lore.find(item => item.visibility === 'public') || { id: 'public-lore', title: 'What everyone knows', content: '', visibility: 'public', keywords: [] }
      const directorLore = data.lore.find(item => item.visibility === 'director') || { id: 'director-lore', title: 'What stays behind the curtain', content: '', visibility: 'director', keywords: [] }
      if (!data.lore.includes(publicLore)) data.lore.push(publicLore)
      if (!data.lore.includes(directorLore)) data.lore.push(directorLore)
      return el('div', {},
        el('div', { class: 'wizard-intro' }, el('h3', { text: 'Set the world’s promises' }), el('p', { text: 'Rules keep the story consistent. Public lore can be learned immediately; behind-the-curtain notes guide the story without being shown to players.' })),
        el('label', {}, el('span', { text: 'Opening situation' }), el('textarea', { required: true, rows: 6, value: data.opening_scene, on: { input: event => { data.opening_scene = event.target.value } } })),
        el('label', {}, el('span', { text: 'What everyone knows at the beginning' }), el('textarea', { rows: 4, value: publicLore.content, on: { input: event => { publicLore.content = event.target.value } } })),
        el('label', {}, el('span', { text: 'What stays behind the curtain' }), el('textarea', { rows: 4, value: directorLore.content, on: { input: event => { directorLore.content = event.target.value } } })),
        el('details', { class: 'friendly-details' }, el('summary', { text: 'Consistency rules (advanced)' }),
          el('p', { class: 'microcopy', text: 'Write one plain-language promise per line, such as “A locked door needs a key or another credible method.”' }),
          el('textarea', { rows: 7, value: (data.world_rules || []).join('\n'), on: { input: event => { data.world_rules = lines(event.target.value) } } }),
        ),
      )
    }
    if (step === 3) {
      const addScene = () => { data.scenes.push({ id: `scene-${crypto.randomUUID()}`, title: 'New scene', location: '', time: '', objective: '', active_character_ids: data.characters.map(item => item.temporary_id || item.character_id).filter(Boolean) }); redraw() }
      return el('div', {},
        el('div', { class: 'wizard-intro' }, el('h3', { text: 'Sketch a few possible scenes' }), el('p', { text: 'Scenes are places to arrive, not a rigid script. The player can still change what happens.' })),
        el('div', { class: 'scene-editor-list' }, ...data.scenes.map((scene, index) => el('article', { class: 'scene-editor-card' },
          el('div', { class: 'cast-editor-heading' }, el('span', { class: 'step-number', text: String(index + 1) }), el('strong', { text: scene.title || `Scene ${index + 1}` }), data.scenes.length > 1 ? el('button', { type: 'button', class: 'danger compact', text: 'Remove', on: { click: () => { data.scenes.splice(index, 1); redraw() } } }) : null),
          el('div', { class: 'form-row' },
            el('label', {}, el('span', { text: 'Scene name' }), el('input', { required: true, value: scene.title, on: { input: event => { scene.title = event.target.value } } })),
            el('label', {}, el('span', { text: 'Location' }), el('input', { value: scene.location, on: { input: event => { scene.location = event.target.value } } })),
          ),
          el('label', {}, el('span', { text: 'What pressure or question makes this scene useful?' }), el('textarea', { rows: 3, value: scene.objective || '', on: { input: event => { scene.objective = event.target.value } } })),
        ))),
        el('button', { type: 'button', class: 'secondary', text: '+ Add a possible scene', on: { click: addScene } }),
      )
    }
    return el('div', { class: 'wizard-review' },
      el('p', { class: 'eyebrow', text: 'Playable story preview' }),
      el('h2', { text: data.title }), el('p', { class: 'lead', text: data.hook || data.summary }),
      el('div', { class: 'review-facts' },
        el('span', {}, el('small', { text: 'Genre' }), el('strong', { text: data.genre || 'Open genre' })),
        el('span', {}, el('small', { text: 'Cast' }), el('strong', { text: `${data.characters.length} character${data.characters.length === 1 ? '' : 's'}` })),
        el('span', {}, el('small', { text: 'Scenes' }), el('strong', { text: String(data.scenes.length) })),
      ),
      el('div', { class: 'cast-preview' }, ...data.characters.map((character, index) => el('div', { class: 'cast-chip' }, avatar(character, 'sm'), el('span', { text: `${character.name} · ${memberFor(character).role}` })))),
      el('div', { class: 'detail-box' }, el('h3', { text: 'Opening' }), el('p', { text: data.opening_scene })),
      el('div', { class: 'profile-actions' },
        el('button', { type: 'button', class: 'secondary', text: 'Save private draft', on: { click: async () => { validateCast(); await save(); closeModal(); await refresh(); toast(t('saved')) } } }),
        el('button', { type: 'button', class: 'secondary', text: t('publish'), on: { click: async () => { validateCast(); await save(); await publishDraft(draft.id, false) } } }),
        el('button', { type: 'button', text: t('publishPlay'), on: { click: async () => { validateCast(); await save(); await publishDraft(draft.id, true) } } }),
      ),
      el('p', { class: 'microcopy', text: 'Playtest creates your own private playthrough. It does not publish the story outside this Tavern.' }),
    )
  }
  openWizard({ title: `${t('editDraft')}: ${draft.title}`, labels: ['Overview', 'Cast', 'World', 'Scenes', 'Preview'], renderStep, onNext: async step => { if (step === 1) validateCast(); if (step < 4) await save() }, finishLabel: 'Close', onFinish: closeModal })
}

async function publishDraft(draftId, startPlaythrough) {
  const result = await api(`/api/creator/drafts/${encodeURIComponent(draftId)}/publish`, { method: 'POST', body: JSON.stringify({ start_playthrough: startPlaythrough, persona_id: currentDefaultPersona()?.id || null }) })
  closeModal()
  await refresh()
  toast(t('created'))
  if (result.playthrough?.conversation?.id) return openConversation(result.playthrough.conversation.id)
  if (result.story) return openStoryDetail(result.story.id)
  if (result.character) return openCharacterProfile(result.character.id)
}

function openPersonaEditor(personaId = null) {
  const persona = state.boot.personas.find(item => item.id === personaId) || { name: '', description: '', style: '' }
  const form = el('form', { class: 'friendly-form' },
    el('label', {}, el('span', { text: 'Name' }), el('input', { name: 'name', value: persona.name, required: true })),
    el('label', {}, el('span', { text: 'Public description' }), el('textarea', { name: 'description', rows: 4, value: persona.description })),
    el('label', {}, el('span', { text: 'How stories should treat this identity' }), el('textarea', { name: 'style', rows: 4, value: persona.style })),
    el('button', { type: 'submit', text: t('save') }),
  )
  form.addEventListener('submit', async event => {
    event.preventDefault()
    const path = persona.id ? `/api/personas/${persona.id}` : '/api/personas'
    await api(path, { method: persona.id ? 'PATCH' : 'POST', body: JSON.stringify(formObject(form)) })
    closeModal(); await refresh(); toast(t('saved'))
  })
  openModal(persona.id ? `${t('edit')}: ${persona.name}` : 'New Persona', form)
}

async function toggleFavorite(entityType, entityId, favorite, reopen = null) {
  await api('/api/favorites', { method: 'POST', body: JSON.stringify({ entity_type: entityType, entity_id: entityId, favorite }) })
  closeModal()
  await refresh()
  if (reopen) await reopen()
}

async function openShare(entityType, entityId, title) {
  const form = el('form', { class: 'friendly-form' },
    el('p', { text: 'Choose what people receive. A preview hides private creator information. An importable copy includes the material required to run or remix the character or story.' }),
    el('div', { class: 'choice-list compact-choice-list' },
      el('label', { class: 'choice-radio' }, el('input', { type: 'radio', name: 'scope', value: 'preview' }), el('span', {}, el('strong', { text: 'View-only preview' }), el('small', { text: 'Best for showing someone what you made without sharing private authoring data.' }))),
      el('label', { class: 'choice-radio' }, el('input', { type: 'radio', name: 'scope', value: 'remix', checked: true }), el('span', {}, el('strong', { text: 'Importable copy' }), el('small', { text: 'Lets another Tavern import and edit their own independent copy.' }))),
    ),
    el('label', {}, el('span', { text: 'Link expiry' }), el('select', { name: 'expires_in_days' },
      el('option', { value: '7', text: '7 days' }),
      el('option', { value: '30', text: '30 days', selected: true }),
      el('option', { value: '90', text: '90 days' }),
      el('option', { value: '365', text: '1 year' }),
    )),
    el('button', { type: 'submit', text: 'Create share link' }),
  )
  form.addEventListener('submit', async event => {
    event.preventDefault()
    const values = formObject(form)
    const link = await api('/api/shares', { method: 'POST', body: JSON.stringify({ resource_type: entityType, resource_id: entityId, scope: values.scope, expires_in_days: Number(values.expires_in_days) }) })
    const filename = `${title.replace(/[^\p{L}\p{N}]+/gu, '-') || 'tavern-content'}.tavern.json`
    const portable = async () => {
      const pack = await api(entityType === 'character' ? `/api/exports/characters/${encodeURIComponent(entityId)}` : `/api/exports/stories/${encodeURIComponent(entityId)}`)
      downloadJson(pack, filename)
    }
    const content = el('div', {},
      el('p', { text: values.scope === 'remix' ? 'Anyone with this link can preview and import an independent copy until the link expires.' : 'Anyone with this link can view a safe public preview until the link expires.' }),
      el('div', { class: 'share-link' }, el('input', { value: link.url, readOnly: true }), el('button', { text: t('copy'), on: { click: () => copyText(link.url) } })),
      el('div', { class: 'profile-actions' },
        typeof navigator.share === 'function' ? el('button', { text: 'Share from this device', on: { click: () => navigator.share({ title, text: values.scope === 'remix' ? `Open or remix “${title}” in Harness Tavern.` : `Preview “${title}” in Harness Tavern.`, url: link.url }).catch(error => { if (error.name !== 'AbortError') toast(error.message) }) } }) : null,
        el('button', { class: 'secondary', text: 'Download portable Tavern pack', on: { click: portable } }),
        entityType === 'story' ? el('button', { class: 'secondary', text: 'Download editable Story source', on: { click: async () => downloadJson(await api(`/api/exports/stories/${entityId}?format=source`), `${title}.story.tavern.json`) } }) : null,
        entityType === 'character' ? el('button', { class: 'secondary', text: 'Download SillyTavern V2 card', on: { click: async () => downloadJson(await api(`/api/exports/characters/${entityId}?format=sillytavern-v2`), `${title}.character.json`) } }) : null,
      ),
      el('p', { class: 'microcopy', text: 'The portable file works between independent Tavern installations. A link works while this Tavern server is reachable.' }),
    )
    openModal(`${t('share')}: ${title}`, content)
  })
  openModal(`${t('share')}: ${title}`, form)
}

async function openShareManager() {
  const shares = await api('/api/shares')
  const list = el('div', { class: 'share-manager-list' })
  const rows = Array.isArray(shares) ? shares : shares.shares || []
  if (!rows.length) {
    list.append(emptyState(t('noShares')))
  } else {
    for (const share of rows) {
      const active = Boolean(share.active)
      const resourceLabel = share.resource_type === 'conversation'
        ? 'Playthrough preview'
        : share.resource_type === 'story'
          ? 'Story'
          : 'Character'
      const scopeLabel = share.scope === 'remix' ? 'Importable copy' : 'View-only preview'
      const expiry = share.expires_at
        ? new Intl.DateTimeFormat(getLocale() === 'zh' ? 'zh-CN' : 'en-GB', { dateStyle: 'medium' }).format(new Date(share.expires_at))
        : 'No expiry'
      const revoke = el('button', {
        class: 'secondary danger',
        text: t('revoke'),
        disabled: !active,
        on: {
          click: async () => {
            if (!confirm(`Stop sharing “${share.title}”? Existing links will no longer open.`)) return
            await api(`/api/shares/${encodeURIComponent(share.token_hash)}`, { method: 'DELETE' })
            toast(t('saved'))
            await openShareManager()
          },
        },
      })
      list.append(el('article', { class: `share-manager-item ${active ? '' : 'inactive'}` },
        el('div', {},
          el('strong', { text: share.title || 'Shared Tavern content' }),
          el('small', { text: `${resourceLabel} · ${scopeLabel} · expires ${expiry}` }),
          el('small', { text: `Created ${relativeTime(share.created_at, getLocale())}` }),
          el('span', { class: `status-pill ${active ? 'active' : ''}`, text: active ? t('active') : t('expired') }),
        ),
        revoke,
      ))
    }
  }
  openModal(t('manageShares'), el('div', {},
    el('p', { text: 'Share links are temporary access. Portable Tavern files remain independent copies and cannot be revoked.' }),
    list,
  ), { wide: true })
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text) } catch {
    const area = el('textarea', { value: text })
    document.body.append(area); area.select(); document.execCommand('copy'); area.remove()
  }
  toast(t('copied'))
}

function openImportDialog(content = '') {
  if (content) {
    previewImport(content).catch(error => toast(error.message))
    return
  }
  const paste = el('textarea', { name: 'content', rows: 10, placeholder: '{ … }' })
  const form = el('form', { class: 'friendly-form' },
    el('button', { type: 'button', class: 'file-drop', on: { click: () => $('#importFile').click() } },
      el('span', { class: 'choice-icon', text: '⇧' }),
      el('strong', { text: 'Choose one editable file' }),
      el('small', { text: 'Tavern story packs and SillyTavern Character Card JSON are supported. Editable Story source JSON works too.' }),
    ),
    el('button', { type: 'button', class: 'file-drop secondary-project-drop', on: { click: () => $('#storyProjectFiles').click() } },
      el('span', { class: 'choice-icon', text: '▦' }),
      el('strong', { text: 'Choose a Story project folder' }),
      el('small', { text: 'Imports story.tavern.json together with relative Character, Lorebook and Markdown scene files.' }),
    ),
    el('details', { class: 'advanced-details' },
      el('summary', { text: 'Paste shared text instead' }),
      el('label', {}, el('span', { text: t('pasteJson') }), paste),
    ),
    el('button', { type: 'submit', class: 'secondary', text: t('previewImport') }),
  )
  form.addEventListener('submit', async event => {
    event.preventDefault()
    const value = paste.value.trim()
    if (!value) return $('#importFile').click()
    await previewImport(value)
  })
  openModal(t('importShare'), form, { wide: true })
}

async function previewImport(content) {
  const preview = await api('/api/import/preview', { method: 'POST', body: JSON.stringify({ content }) })
  state.importContent = content
  const body = el('div', {},
    el('div', { class: 'import-preview' }, el('h3', { text: preview.title || preview.kind }), preview.counts ? el('p', { text: `${preview.counts.characters} characters · ${preview.counts.stories} stories · ${preview.counts.personas} Personas` }) : null, preview.conflicts?.length ? el('p', { text: `${preview.conflicts.length} matching item(s) already exist.` }) : null, ...(preview.warnings || []).map(message => el('p', { text: message }))),
    el('div', { class: 'profile-actions' },
      el('button', { text: t('importCopy'), on: { click: () => applyImport('copy') } }),
      preview.conflicts?.length ? el('button', { class: 'secondary', text: t('replace'), on: { click: () => applyImport('replace') } }) : null,
    ),
  )
  openModal(t('previewImport'), body)
}

async function storyProjectBundle(fileList) {
  const files = {}
  for (const file of fileList) files[file.webkitRelativePath || file.name] = await file.text()
  const manifests = Object.keys(files).filter(path => path.endsWith('/story.tavern.json') || path === 'story.tavern.json' || path.endsWith('.story.tavern.json'))
  if (manifests.length !== 1) throw new Error('Choose one Story project folder containing exactly one story.tavern.json manifest.')
  return { format: 'harness-tavern-story-project-files', manifest_path: manifests[0], files }
}

async function applyImport(strategy) {
  await api('/api/import/apply', { method: 'POST', body: JSON.stringify({ content: state.importContent, strategy, source_name: 'Tavern UI import' }) })
  state.importContent = null
  closeModal(); await refresh(); showView('library'); toast(t('imported'))
}

function openProviderForm() {
  const presets = state.boot.provider_presets
  const recommendedIds = ['openrouter', 'openai', 'anthropic', 'google-ai-studio', 'deepseek', 'ollama']
  const recommended = recommendedIds.map(id => presets.find(item => item.id === id)).filter(Boolean)
  const root = el('div', { class: 'provider-wizard' })

  const choose = presetId => {
    const preset = presets.find(item => item.id === presetId) || presets[0]
    const isLocal = preset.category === 'local'
    const hasOpenRouterAccount = state.boot.account_connections.some(item => item.connector_id === 'openrouter-oauth')
    const address = el('input', { name: 'base_url', value: preset.baseUrl || '', required: !preset.baseUrl })
    const keyInput = el('input', { name: 'api_key', type: 'password', autocomplete: 'off', placeholder: isLocal ? 'Not needed for most local models' : 'Paste the key supplied by this service' })
    const form = el('form', { class: 'friendly-form provider-setup-form' },
      el('button', { type: 'button', class: 'text-button back-button', text: '← Choose a different service', on: { click: renderChoices } }),
      el('div', { class: 'provider-selected' },
        el('span', { class: 'choice-icon', text: preset.id === 'openrouter' ? '◈' : isLocal ? '⌂' : '✦' }),
        el('div', {}, el('h3', { text: preset.label }), el('p', { text: preset.notes || (isLocal ? 'Use a model already running on this computer.' : 'Connect your own account securely. Your access key stays encrypted on this device.') })),
      ),
      preset.id === 'openrouter' && !hasOpenRouterAccount ? el('div', { class: 'connection-shortcut' },
        el('strong', { text: 'Easiest option' }),
        el('p', { text: 'Sign in to OpenRouter and approve this Tavern. You will not need to copy a key.' }),
        el('button', { type: 'button', class: 'openrouter-button', text: 'Connect my OpenRouter account', on: { click: async () => { const result = await api('/api/account-connections/openrouter-oauth/begin', { method: 'POST', body: '{}' }); location.href = result.authorization_url } } }),
        el('span', { class: 'form-divider', text: 'or use an access key' }),
      ) : null,
      preset.id === 'openrouter' && hasOpenRouterAccount ? el('div', { class: 'success-note', text: '✓ Your OpenRouter account is already connected. Just save this service.' }) : null,
      el('label', {}, el('span', { text: 'Name shown in Tavern' }), el('input', { name: 'label', value: preset.label, required: true, maxlength: 120 })),
      !preset.noKey && !(preset.id === 'openrouter' && hasOpenRouterAccount) ? el('label', {}, el('span', { text: 'Access key' }), keyInput, el('small', { text: 'Encrypted before it is saved. Tavern never includes it in exports or share packs.' })) : null,
      el('label', {}, el('span', { text: 'Preferred model (optional)' }), el('input', { name: 'default_model', value: preset.defaultModel || '', placeholder: 'Leave blank and choose later' })),
      isLocal ? el('label', {}, el('span', { text: 'Local server address' }), address, el('small', { text: 'The suggested address works for the usual installation.' })) : null,
      el('details', { class: 'advanced-details' },
        el('summary', { text: 'Advanced connection options' }),
        !isLocal ? el('label', {}, el('span', { text: 'Service address' }), address) : null,
        preset.id === 'openrouter' ? el('div', {},
          el('label', {}, el('span', { text: 'Prefer these model providers' }), el('input', { name: 'route_order', placeholder: 'For example: Anthropic, Google' })),
          el('label', {}, el('span', { text: 'Fallback models' }), el('input', { name: 'route_models', placeholder: 'Optional, comma separated' })),
        ) : null,
      ),
      el('button', { type: 'submit', text: 'Save AI service' }),
    )
    form.addEventListener('submit', async event => {
      event.preventDefault()
      const values = formObject(form)
      try {
        await api('/api/provider-connections', { method: 'POST', body: JSON.stringify({
          provider_id: preset.id,
          label: values.label || preset.label,
          base_url: values.base_url || preset.baseUrl,
          api_key: values.api_key || undefined,
          default_model: values.default_model || '',
          route: {
            order: values.route_order?.split(',').map(item => item.trim()).filter(Boolean),
            models: values.route_models?.split(',').map(item => item.trim()).filter(Boolean),
          },
          allow_empty_key: Boolean(preset.noKey || (preset.id === 'openrouter' && hasOpenRouterAccount)),
        }) })
        closeModal(); await refresh(); $('#aiConnectionsPanel').open = true; toast(t('saved'))
      } catch (error) {
        toast(error.message, 7000)
      }
    })
    clear(root).append(form)
  }

  const renderChoices = () => {
    const other = el('select', { name: 'other-provider' },
      el('option', { value: '', text: 'Choose another service…' }),
      ...presets.filter(item => !recommendedIds.includes(item.id)).map(item => el('option', { value: item.id, text: item.label })),
    )
    other.addEventListener('change', () => { if (other.value) choose(other.value) })
    clear(root).append(
      el('div', { class: 'provider-wizard-intro' },
        el('p', { text: 'Tavern already includes a demo model. Add another service only when you want a wider model choice or higher-quality roleplay.' }),
      ),
      el('div', { class: 'provider-choice-grid' }, ...recommended.map(preset => el('button', { class: 'provider-choice', on: { click: () => choose(preset.id) } },
        el('span', { class: 'choice-icon', text: preset.id === 'openrouter' ? '◈' : preset.category === 'local' ? '⌂' : '✦' }),
        el('strong', { text: preset.label }),
        el('small', { text: preset.id === 'openrouter' ? 'One account, many models · recommended' : preset.category === 'local' ? 'Use a model on this computer' : 'Connect your own account' }),
      ))),
      el('label', { class: 'other-provider-select' }, el('span', { text: 'More services' }), other),
      el('p', { class: 'microcopy', text: 'Advanced users can change server addresses and routing after choosing a service.' }),
    )
  }
  renderChoices()
  openModal(t('addConnection'), root, { wide: true })
}

async function removeConnection(connectionId) {
  if (!confirm('Remove this API connection?')) return
  await api(`/api/provider-connections/${connectionId}`, { method: 'DELETE' })
  await refresh(); $('#aiConnectionsPanel').open = true
}
async function disconnectAccount(accountId) {
  if (!confirm('Disconnect this account?')) return
  await api(`/api/account-connections/${accountId}`, { method: 'DELETE' })
  await refresh(); $('#aiConnectionsPanel').open = true
}
async function toggleExtension(extensionId, enabled) {
  await api(`/api/extensions/${extensionId}`, { method: 'PATCH', body: JSON.stringify({ enabled }) })
  await refresh(); $('#extensionsPanel').open = true
}
async function removeExtension(extensionId) {
  if (!confirm('Remove this extension?')) return
  await api(`/api/extensions/${extensionId}`, { method: 'DELETE' })
  await refresh(); $('#extensionsPanel').open = true
}
function installExtensionDialog() {
  let manifest = null
  const preview = el('div', { class: 'import-preview muted-box' },
    el('strong', { text: 'Choose an extension pack to preview it.' }),
    el('p', { text: 'Extensions may add story templates, character templates, quick actions, and visual themes. They cannot execute code.' }),
  )
  const fileInput = el('input', { type: 'file', accept: 'application/json,.json,.tavern-extension', hidden: true })
  const paste = el('textarea', { name: 'manifest', rows: 10, placeholder: '{ "format": "harness-tavern-extension", … }' })
  const install = el('button', { type: 'submit', text: t('installExtension'), disabled: true })
  const form = el('form', { class: 'friendly-form' },
    el('p', { text: t('extensionHint') }),
    fileInput,
    el('button', { type: 'button', class: 'file-drop', on: { click: () => fileInput.click() } },
      el('span', { class: 'choice-icon', text: '＋' }),
      el('strong', { text: 'Choose extension pack' }),
      el('small', { text: 'You will see exactly what it adds before installation.' }),
    ),
    preview,
    el('details', { class: 'advanced-details' },
      el('summary', { text: 'For extension authors: paste the manifest' }),
      paste,
      el('button', { type: 'button', class: 'secondary', text: 'Preview pasted manifest', on: { click: () => loadManifest(paste.value) } }),
    ),
    install,
  )
  const loadManifest = async raw => {
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      const result = await api('/api/extensions/preview', { method: 'POST', body: JSON.stringify(parsed) })
      manifest = parsed
      const counts = result.counts || {}
      clear(preview).append(
        el('h3', { text: result.manifest.name }),
        el('p', { text: result.manifest.description || 'No description provided.' }),
        el('p', { text: [
          `${counts.story_templates || 0} story templates`,
          `${counts.character_templates || 0} character templates`,
          `${counts.quick_actions || 0} quick actions`,
          `${counts.themes || 0} themes`,
        ].join(' · ') }),
        ...result.warnings.map(message => el('p', { class: 'microcopy', text: message })),
      )
      install.disabled = false
    } catch (error) {
      manifest = null
      install.disabled = true
      clear(preview).append(el('strong', { text: 'This extension could not be previewed.' }), el('p', { text: error.message }))
    }
  }
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    if (!file) return
    await loadManifest(await file.text())
  })
  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (!manifest) return toast('Choose and preview an extension pack first')
    await api('/api/extensions', { method: 'POST', body: JSON.stringify(manifest) })
    closeModal(); await refresh(); $('#extensionsPanel').open = true; toast(t('saved'))
  })
  openModal(t('installExtension'), form, { wide: true })
}

function showOnboarding() {
  const layer = $('#onboardingLayer')
  const card = $('#onboarding')
  layer.classList.remove('hidden')
  const first = () => {
    clear(card).append(el('div', { class: 'onboarding-step' },
      el('p', { class: 'eyebrow', text: 'Harness Tavern' }),
      el('h1', { id: 'onboardingTitle', text: t('welcome') }),
      el('p', { text: t('welcomeBody') }),
      el('form', { class: 'friendly-form', on: { submit: event => {
        event.preventDefault()
        const values = formObject(event.currentTarget)
        setLocale(values.locale)
        api('/api/user-profile', { method: 'PATCH', body: JSON.stringify({ name: values.name, locale: values.locale, default_persona_id: currentDefaultPersona()?.id || null, sync_default_persona: true }) }).then(() => second())
      } } },
        el('label', {}, el('span', { text: t('howCallYou') }), el('input', { name: 'name', required: true, placeholder: t('displayName') })),
        el('label', {}, el('span', { text: 'Language / 语言' }), el('select', { name: 'locale' }, el('option', { value: 'en', text: 'English' }), el('option', { value: 'zh', text: '中文', selected: navigator.language.toLowerCase().startsWith('zh') }))),
        el('button', { type: 'submit', text: t('next') }),
      ),
    ))
  }
  const second = () => {
    applyTranslations()
    clear(card).append(el('div', { class: 'onboarding-step' },
      el('p', { class: 'eyebrow', text: 'Harness Tavern' }), el('h1', { id: 'onboardingTitle', text: t('chooseStart') }),
      el('div', { class: 'onboarding-actions' },
        el('button', { on: { click: () => finish('characters') } }, el('span', { text: '✦' }), el('strong', { text: t('talkCharacter') })),
        el('button', { on: { click: () => finish('stories') } }, el('span', { text: '◇' }), el('strong', { text: t('enterStory') })),
        el('button', { on: { click: () => finish('create') } }, el('span', { text: '＋' }), el('strong', { text: t('makeWorld') })),
      ),
    ))
  }
  const finish = async destination => {
    await api('/api/user-profile', { method: 'PATCH', body: JSON.stringify({ onboarding_complete: true, locale: getLocale() }) })
    layer.classList.add('hidden')
    await refresh()
    if (destination === 'characters' || destination === 'stories') { state.libraryTab = destination; showView('library') }
    else showView(destination)
  }
  first()
}

async function handleShareFromUrl() {
  const url = new URL(location.href)
  const publicToken = url.searchParams.get('shared')
  const legacyCode = url.searchParams.get('share')
  if (!publicToken && !legacyCode) return
  try {
    let pack
    if (publicToken) {
      const shared = await api(`/api/public/shares/${encodeURIComponent(publicToken)}`)
      if (!shared.can_import) throw Object.assign(new Error('This is a view-only preview. Ask the creator for an importable copy.'), { status: 403 })
      pack = shared.snapshot
      url.searchParams.delete('shared')
    } else {
      pack = await api(`/api/share-links/${encodeURIComponent(legacyCode)}`)
      url.searchParams.delete('share')
    }
    history.replaceState(null, '', `${url.pathname}${url.search}#import`)
    await previewImport(JSON.stringify(pack))
  } catch (error) { toast(error.message, 7000) }
}

function wireEvents() {
  $('#primaryNav').addEventListener('click', event => { const button = event.target.closest('[data-view]'); if (button) showView(button.dataset.view) })
  $('#settingsNav').addEventListener('click', () => showView('settings'))
  $('#brandHome').addEventListener('click', () => showView('home'))
  $('#mobileMenu').addEventListener('click', openMobileNav)
  $('#mobileSettings').addEventListener('click', () => showView('settings'))
  $('#mobileScrim').addEventListener('click', () => { closeDrawer(); closeMobileNav() })
  $('#libraryTabs').addEventListener('click', event => { const button = event.target.closest('[data-tab]'); if (!button) return; state.libraryTab = button.dataset.tab; renderLibrary() })
  $('#librarySearch').addEventListener('input', renderLibrary)
  $('#composer').addEventListener('submit', async event => { event.preventDefault(); if (state.streaming) { await api(`/api/conversations/${state.conversationId}/cancel`, { method: 'POST' }); return } await sendCurrentMessage() })
  $('#messageInput').addEventListener('input', event => { event.target.style.height = 'auto'; event.target.style.height = `${Math.min(200, event.target.scrollHeight)}px` })
  $('#profileForm').addEventListener('submit', async event => { event.preventDefault(); await api('/api/user-profile', { method: 'PATCH', body: JSON.stringify(formObject(event.currentTarget)) }); await refresh(); toast(t('saved')) })
  $('#connectOpenRouter').addEventListener('click', async () => { const result = await api('/api/account-connections/openrouter-oauth/begin', { method: 'POST', body: '{}' }); location.href = result.authorization_url })
  $('#importFile').addEventListener('change', async event => { const file = event.target.files[0]; if (!file) return; const text = await file.text(); event.target.value = ''; await previewImport(text) })
  $('#storyProjectFiles').addEventListener('change', async event => {
    const files = [...event.target.files]
    if (!files.length) return
    try { await previewImport(await storyProjectBundle(files)) } finally { event.target.value = '' }
  })
  $('#modalLayer').addEventListener('click', event => { if (event.target === $('#modalLayer')) closeModal() })
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeModal(); closeDrawer(); closeMobileNav() } })
  document.addEventListener('click', event => {
    const action = event.target.closest('[data-action]')?.dataset.action
    if (!action) return
    const actions = {
      'explore-stories': () => { state.libraryTab = 'stories'; showView('library') },
      'view-stories': () => { state.libraryTab = 'stories'; showView('library') },
      'view-characters': () => { state.libraryTab = 'characters'; showView('library') },
      'view-all-chats': () => showView('chats'),
      'quick-create-character': () => quickCreate('character'),
      'quick-create-story': () => quickCreate('story'),
      'new-chat': () => { state.libraryTab = 'characters'; showView('library') },
      'open-import': () => openImportDialog(),
      'export-library': async () => downloadJson(await api('/api/exports/library'), 'my-tavern-library.tavern.json'),
      'manage-shares': () => openShareManager(),
      'add-provider': openProviderForm,
      'install-extension': installExtensionDialog,
      'leave-chat': () => showView('chats'),
      'open-cast': openCastDrawer,
      'open-journal': openJournalDrawer,
      'open-model-controls': openModelControlsDrawer,
      'open-chat-more': openChatMoreDrawer,
      'close-modal': closeModal,
      'close-drawer': closeDrawer,
    }
    actions[action]?.()
  })
}

async function bootstrap() {
  const url = new URL(location.href)
  if (url.searchParams.get('token')) {
    setAccessToken(url.searchParams.get('token'))
    url.searchParams.delete('token')
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }
  try {
    await api('/api/health')
    $('#healthDot').classList.add('ok')
    $('#healthText').textContent = 'Ready'
  } catch (error) {
    if (error.status === 401 && !getAccessToken()) {
      const token = prompt('This Tavern requires an access token:')
      if (token) { setAccessToken(token); return bootstrap() }
    }
    throw error
  }
  state.boot = await api('/api/bootstrap')
  setLocale(state.boot.user_profile.locale || (navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'))
  applyTranslations()
  renderAll()
  wireEvents()
  const hash = location.hash.replace(/^#/, '')
  if (hash.startsWith('chat/')) await openConversation(decodeURIComponent(hash.slice(5)))
  else showView(['home','chats','library','create','settings'].includes(hash) ? hash : 'home', { updateHash: false })
  if (!state.boot.user_profile.onboarding_complete) showOnboarding()
  await handleShareFromUrl()
  const oauth = new URL(location.href).searchParams.get('oauth')
  if (oauth === 'success') { $('#aiConnectionsPanel').open = true; showView('settings'); toast('OpenRouter connected') }
}

bootstrap().catch(error => {
  console.error(error)
  $('#healthText').textContent = error.message
  toast(error.message, 10_000)
})
