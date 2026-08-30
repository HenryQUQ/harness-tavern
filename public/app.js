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
  modalCloseGuard: null,
  importContent: null,
  migrationId: null,
  inspectorTab: 'facts',
  inspectorOpen: true,
}

function toast(message, duration = 3200) {
  const node = $('#toast')
  node.textContent = message
  node.classList.remove('hidden')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => node.classList.add('hidden'), duration)
}

function uiText(zh, en) {
  return getLocale() === 'zh' ? zh : en
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
  if (!['home', 'chats', 'library', 'settings', 'chat'].includes(view)) view = 'home'
  state.view = view
  $$('.view').forEach(node => node.classList.toggle('active', node.id === `view-${view}`))
  $$('#primaryNav button, #settingsNav').forEach(button => button.classList.toggle('active', button.dataset.view === view))
  if (updateHash && view !== 'chat') history.replaceState(null, '', `#${view}`)
  closeMobileNav()
  if (view === 'home') renderHome()
  if (view === 'chats') renderChats()
  if (view === 'library') renderLibrary()
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

function openModal(title, content, { wide = false, workspace = false, autoFocus = true, beforeClose = null } = {}) {
  $('#modalTitle').textContent = title
  clear($('#modalBody')).append(content)
  $('#modal').classList.toggle('modal-wide', wide)
  $('#modal').classList.toggle('modal-workspace', workspace)
  $('#modalBody').classList.toggle('workspace-body', workspace)
  $('#modalLayer').classList.remove('hidden')
  state.modal = title
  state.modalCloseGuard = beforeClose
  if (autoFocus) setTimeout(() => $('#modalBody input, #modalBody textarea, #modalBody select')?.focus(), 20)
}
function closeModal({ force = false } = {}) {
  if (!force && state.modalCloseGuard && state.modalCloseGuard() === false) return false
  $('#modalLayer').classList.add('hidden')
  state.modal = null
  state.modalCloseGuard = null
  return true
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
    el('div', {}, el('strong', { text: extension.name }), el('small', { text: `${extension.description || 'Adds optional declarative contributions.'} · v${extension.version}` })),
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
  renderSettings()
}

function parseEditorJson(source, label, { array = false } = {}) {
  let value
  try { value = JSON.parse(String(source || '').trim() || (array ? '[]' : '{}')) } catch (error) {
    throw new Error(`${label}: ${uiText('JSON 格式无效', 'invalid JSON')} (${error.message})`)
  }
  if (array ? !Array.isArray(value) : !value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} ${array ? uiText('必须是 JSON 数组。', 'must be a JSON array.') : uiText('必须是 JSON 对象。', 'must be a JSON object.')}`)
  }
  return value
}

function nextEditorKey(prefix, items, fields = ['id', 'key']) {
  const used = new Set(items.flatMap(item => fields.map(field => item?.[field]).filter(Boolean)))
  let index = items.length + 1
  let candidate = `${prefix}-${index}`
  while (used.has(candidate)) candidate = `${prefix}-${++index}`
  return candidate
}

function openContentEditor({ modalTitle, eyebrow, title, summary, tabs, renderPanel, onSave, headerAside = null }) {
  let active = tabs[0].id
  let dirty = false
  let busy = false
  const root = el('form', { class: 'editor-workbench' })
  const heading = el('h2', { text: title })
  const status = el('span', { class: 'editor-save-state clean', role: 'status', 'aria-live': 'polite', text: uiText('已载入最新内容', 'Latest content loaded') })
  const nav = el('nav', { class: 'editor-tabs', role: 'tablist', 'aria-label': uiText('编辑区域', 'Editor sections') })
  const panel = el('div', { class: 'editor-panel', role: 'tabpanel' })
  const saveButton = el('button', { type: 'submit', disabled: true, text: uiText('保存修改', 'Save changes') })
  const doneButton = el('button', { type: 'button', class: 'secondary', text: uiText('完成', 'Done'), on: { click: () => closeModal() } })

  const markDirty = () => {
    if (dirty) return
    dirty = true
    saveButton.disabled = false
    status.className = 'editor-save-state dirty'
    status.textContent = uiText('有未保存修改', 'Unsaved changes')
  }
  const draw = () => {
    clear(nav).append(...tabs.map(tab => el('button', {
      type: 'button',
      role: 'tab',
      'aria-selected': active === tab.id ? 'true' : 'false',
      class: active === tab.id ? 'active' : '',
      text: tab.label,
      on: { click: () => { active = tab.id; draw() } },
    })))
    clear(panel).append(renderPanel(active, { markDirty, redraw: draw }))
  }

  root.addEventListener('input', markDirty)
  root.addEventListener('submit', async event => {
    event.preventDefault()
    if (busy || !dirty) return
    const invalid = root.querySelector(':invalid')
    if (invalid) { invalid.reportValidity(); return }
    busy = true
    saveButton.disabled = true
    status.className = 'editor-save-state saving'
    status.textContent = uiText('正在验证并保存…', 'Validating and saving…')
    try {
      const result = await onSave()
      dirty = false
      heading.textContent = result?.title || heading.textContent
      status.className = 'editor-save-state clean'
      status.textContent = uiText('刚刚已保存', 'Saved just now')
      toast(uiText('内容已验证并保存', 'Content validated and saved'))
    } catch (error) {
      saveButton.disabled = false
      status.className = 'editor-save-state conflict'
      status.textContent = ['story_source_conflict', 'character_edit_conflict'].includes(error.code)
        ? uiText('发现较新的修改，请重新载入', 'Newer changes found — reload first')
        : uiText('保存失败', 'Save failed')
      toast(error.message, 7000)
    } finally { busy = false }
  })

  root.append(
    el('header', { class: 'editor-masthead' },
      el('div', {}, el('p', { class: 'eyebrow', text: eyebrow }), heading, el('p', { text: summary })),
      headerAside,
    ),
    nav,
    panel,
    el('footer', { class: 'editor-savebar' }, status, el('div', { class: 'editor-save-actions' }, doneButton, saveButton)),
  )
  draw()
  openModal(modalTitle, root, {
    workspace: true,
    autoFocus: false,
    beforeClose: () => !dirty || confirm(uiText('放弃尚未保存的修改？', 'Discard unsaved changes?')),
  })
  return {
    markDirty,
    redraw: draw,
    get dirty() { return dirty },
  }
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
      el('button', { class: 'secondary', text: uiText('编辑角色', 'Edit character'), on: { click: () => openCharacterEditor(character.id) } }),
      el('button', { class: 'secondary', text: fav ? t('unfavorite') : t('favorite'), on: { click: () => toggleFavorite('character', character.id, !fav, () => openCharacterProfile(character.id)) } }),
      el('button', { class: 'secondary', text: t('share'), on: { click: () => openShare('character', character.id, character.name) } }),
    ),
  )
  openModal(character.name, content)
}

async function openCharacterEditor(characterId) {
  let loaded = await api(`/api/creator/characters/${encodeURIComponent(characterId)}`)
  let data = structuredClone(loaded.character)
  let metadataSource = JSON.stringify(data.metadata || {}, null, 2)
  let extensionsSource = JSON.stringify(data.extensions || {}, null, 2)
  const tabs = [
    { id: 'identity', label: uiText('身份', 'Identity') },
    { id: 'voice', label: uiText('声音与相遇', 'Voice & meeting') },
    { id: 'intent', label: uiText('意图与隐私', 'Intent & privacy') },
    { id: 'advanced', label: uiText('高级', 'Advanced') },
  ]
  const renderPanel = (active) => {
    if (active === 'identity') return el('div', { class: 'editor-section' },
      el('div', { class: 'editor-section-heading' }, el('div', {}, el('h3', { text: uiText('这个角色是谁', 'Who this character is') }), el('p', { text: uiText('这些内容构成角色在内容库和分享预览中的基本形象。', 'These fields shape the Character’s Library profile and public presentation.') }))),
      el('div', { class: 'form-row' },
        el('label', {}, el('span', { text: uiText('角色名称', 'Character name') }), el('input', { required: true, maxlength: 120, value: data.name, on: { input: event => { data.name = event.target.value } } })),
        el('label', {}, el('span', { text: uiText('稳定内容 Key', 'Stable content key') }), el('input', { value: data.slug, readOnly: true }), el('small', { text: uiText('系统用于文件引用与存档关联，不随显示名称改变。', 'Used by files and saves; it does not change with the display name.') })),
      ),
      el('label', {}, el('span', { text: uiText('公开介绍', 'Public description') }), el('textarea', { rows: 5, maxlength: 20000, value: data.description, on: { input: event => { data.description = event.target.value } } })),
      el('label', {}, el('span', { text: uiText('外观', 'Appearance') }), el('textarea', { rows: 4, maxlength: 10000, value: data.appearance, on: { input: event => { data.appearance = event.target.value } } })),
      el('div', { class: 'form-row' },
        el('label', {}, el('span', { text: uiText('头像地址', 'Avatar URL') }), el('input', { type: 'url', maxlength: 200000, value: data.avatar_url, placeholder: 'https://…', on: { input: event => { data.avatar_url = event.target.value } } })),
        el('label', {}, el('span', { text: uiText('标签', 'Tags') }), el('input', { maxlength: 3200, value: (data.tags || []).join(', '), placeholder: uiText('例如：侦探, 慢热, 科幻', 'For example: detective, slow-burn, sci-fi'), on: { input: event => { data.tags = event.target.value.split(',').map(item => item.trim()).filter(Boolean) } } })),
      ),
    )
    if (active === 'voice') return el('div', { class: 'editor-section' },
      el('div', { class: 'editor-section-heading' }, el('div', {}, el('h3', { text: uiText('行为方式与表达', 'Behavior and expression') }), el('p', { text: uiText('描述稳定的性格、说话方式，以及第一次相遇如何发生。', 'Define stable behavior, voice, and how the first meeting begins.') }))),
      el('label', {}, el('span', { text: uiText('性格与行为', 'Personality and behavior') }), el('textarea', { rows: 6, maxlength: 20000, value: data.personality, on: { input: event => { data.personality = event.target.value } } })),
      el('label', {}, el('span', { text: uiText('说话风格', 'Speech style') }), el('textarea', { rows: 5, maxlength: 10000, value: data.speech_style, on: { input: event => { data.speech_style = event.target.value } } })),
      el('label', {}, el('span', { text: uiText('相遇场景', 'Meeting scenario') }), el('textarea', { rows: 6, maxlength: 20000, value: data.scenario, on: { input: event => { data.scenario = event.target.value } } })),
      el('label', {}, el('span', { text: uiText('第一条消息', 'First message') }), el('textarea', { rows: 7, maxlength: 20000, value: data.first_message, on: { input: event => { data.first_message = event.target.value } } })),
    )
    if (active === 'intent') return el('div', { class: 'editor-section' },
      el('div', { class: 'editor-section-heading' }, el('div', {}, el('h3', { text: uiText('持续意图与创作者私有内容', 'Durable intent and creator-private content') }), el('p', { text: uiText('每行一项。秘密和创作者备注不会出现在普通角色详情中。', 'Use one item per line. Secrets and creator notes stay out of the ordinary Character profile.') }))),
      el('label', {}, el('span', { text: uiText('长期目标', 'Long-term goals') }), el('textarea', { rows: 6, value: (data.goals || []).join('\n'), on: { input: event => { data.goals = lines(event.target.value) } } })),
      el('label', {}, el('span', { text: uiText('秘密与私人事实', 'Secrets and private facts') }), el('textarea', { rows: 6, value: (data.secrets || []).join('\n'), on: { input: event => { data.secrets = lines(event.target.value) } } })),
      el('label', {}, el('span', { text: uiText('不可越过的边界', 'Boundaries') }), el('textarea', { rows: 6, value: (data.boundaries || []).join('\n'), on: { input: event => { data.boundaries = lines(event.target.value) } } })),
      el('label', {}, el('span', { text: uiText('创作者备注', 'Creator notes') }), el('textarea', { rows: 6, maxlength: 20000, value: data.creator_notes, on: { input: event => { data.creator_notes = event.target.value } } })),
    )
    return el('div', { class: 'editor-section' },
      el('div', { class: 'editor-section-heading' }, el('div', {}, el('h3', { text: uiText('高级兼容数据', 'Advanced compatibility data') }), el('p', { text: uiText('用于 Character Card 扩展和生态兼容。保存前会严格检查 JSON。', 'Used for Character Card extensions and ecosystem compatibility. JSON is validated before saving.') }))),
      loaded.bindings.length ? el('div', { class: 'editor-notice' },
        el('strong', { text: uiText(`该角色属于 ${loaded.bindings.length} 个 Story Source`, `Used by ${loaded.bindings.length} Story source${loaded.bindings.length === 1 ? '' : 's'}`) }),
        el('p', { text: uiText('保存时会同步更新这些标准文件；如果文件在编辑期间被外部修改，系统会拒绝覆盖。', 'Saving updates those standard files. If one changed outside the Tavern while this editor was open, the save is rejected instead of overwriting it.') }),
        el('ul', {}, ...loaded.bindings.map(binding => el('li', { text: `${binding.story_title} · ${binding.character_key}` }))),
      ) : el('div', { class: 'editor-notice' }, el('strong', { text: uiText('独立角色', 'Standalone Character') }), el('p', { text: uiText('当前没有 Story Source 引用该角色。', 'No Story source currently references this Character.') })),
      el('label', {}, el('span', { text: 'Metadata JSON' }), el('textarea', { class: 'json-editor', rows: 12, spellcheck: false, value: metadataSource, on: { input: event => { metadataSource = event.target.value } } })),
      el('label', {}, el('span', { text: 'Extensions JSON' }), el('textarea', { class: 'json-editor', rows: 12, spellcheck: false, value: extensionsSource, on: { input: event => { extensionsSource = event.target.value } } })),
    )
  }
  openContentEditor({
    modalTitle: uiText('编辑角色', 'Edit Character'),
    eyebrow: uiText('角色工作台', 'Character workspace'),
    title: data.name,
    summary: uiText('所有创作字段都可以修改；系统身份、对话历史和审计记录保持只读。', 'Every authored field is editable; system identity, conversation history, and audit records remain read-only.'),
    tabs,
    renderPanel,
    headerAside: avatar(data, 'lg'),
    onSave: async () => {
      if (!String(data.name || '').trim()) throw new Error(uiText('角色名称不能为空。', 'Character name is required.'))
      data.metadata = parseEditorJson(metadataSource, 'Metadata')
      data.extensions = parseEditorJson(extensionsSource, 'Extensions')
      loaded = await api(`/api/creator/characters/${encodeURIComponent(characterId)}`, {
        method: 'PUT',
        body: JSON.stringify({ character: data, expected_token: loaded.edit_token }),
      })
      data = structuredClone(loaded.character)
      metadataSource = JSON.stringify(data.metadata || {}, null, 2)
      extensionsSource = JSON.stringify(data.extensions || {}, null, 2)
      await refresh()
      return { title: data.name }
    },
  })
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
      el('button', { class: 'secondary', text: uiText('编辑故事', 'Edit story'), on: { click: () => openStoryEditor(story.id) } }),
      el('button', { class: 'secondary', text: fav ? t('unfavorite') : t('favorite'), on: { click: () => toggleFavorite('story', story.id, !fav, () => openStoryDetail(story.id)) } }),
      el('button', { class: 'secondary', text: t('share'), on: { click: () => openShare('story', story.id, story.title) } }),
    ),
  )
  openModal(story.title, content, { wide: true })
}

async function openStoryEditor(storyId) {
  let loaded = await api(`/api/creator/stories/${encodeURIComponent(storyId)}`)
  let story = structuredClone(loaded.story)
  let editor
  let selectedCharacterId = ''
  let castMetadataSources = new Map()
  let jsonSources = {}
  const resetJsonSources = () => {
    castMetadataSources = new Map(story.cast.map(member => [member.character_id, JSON.stringify(member.metadata || {}, null, 2)]))
    jsonSources = {
      initial_state: JSON.stringify(story.initial_state || {}, null, 2),
      world_schema: JSON.stringify(story.runtime?.world_schema || {}, null, 2),
      actions: JSON.stringify(story.runtime?.actions || [], null, 2),
      agendas: JSON.stringify(story.runtime?.agendas || [], null, 2),
      prompt_graph: JSON.stringify(story.runtime?.prompt_graph || {}, null, 2),
      state_visibility: JSON.stringify(story.runtime?.state_visibility || [], null, 2),
      metadata: JSON.stringify(story.metadata || {}, null, 2),
      share_policy: JSON.stringify(story.share_policy || {}, null, 2),
    }
  }
  resetJsonSources()

  const tabs = [
    { id: 'overview', label: uiText('概览', 'Overview') },
    { id: 'cast', label: uiText('角色阵容', 'Cast') },
    { id: 'world', label: uiText('世界与知识', 'World & lore') },
    { id: 'scenes', label: uiText('场景', 'Scenes') },
    { id: 'causality', label: uiText('因果规则', 'Causality') },
    { id: 'advanced', label: uiText('高级', 'Advanced') },
  ]

  const renderPanel = (active, { markDirty, redraw }) => {
    if (active === 'overview') return el('div', { class: 'editor-section' },
      el('div', { class: 'editor-section-heading' }, el('div', {}, el('h3', { text: uiText('故事入口', 'Story invitation') }), el('p', { text: uiText('这些内容决定玩家在内容库中看到什么，以及进入故事时理解什么。', 'These fields shape what players see in the Library and understand before entering.') }))),
      el('div', { class: 'form-row' },
        el('label', {}, el('span', { text: uiText('故事标题', 'Story title') }), el('input', { required: true, maxlength: 200, value: story.title, on: { input: event => { story.title = event.target.value } } })),
        el('label', {}, el('span', { text: uiText('稳定 Story Key', 'Stable Story key') }), el('input', { value: story.slug, readOnly: true }), el('small', { text: uiText('用于标准文件与存档关联；需要改名时请在源文件项目中操作。', 'Used by standard files and saves; rename it through the source project when required.') })),
      ),
      el('label', {}, el('span', { text: uiText('一句话吸引点', 'One-line hook') }), el('textarea', { rows: 2, maxlength: 1000, value: story.hook, on: { input: event => { story.hook = event.target.value } } })),
      el('label', {}, el('span', { text: uiText('简短摘要', 'Short summary') }), el('textarea', { rows: 3, maxlength: 4000, value: story.summary, on: { input: event => { story.summary = event.target.value } } })),
      el('label', {}, el('span', { text: uiText('完整前提', 'Full premise') }), el('textarea', { rows: 7, maxlength: 30000, value: story.premise, on: { input: event => { story.premise = event.target.value } } })),
      el('div', { class: 'form-row' },
        el('label', {}, el('span', { text: uiText('类型', 'Genre') }), el('input', { maxlength: 300, value: story.genre, on: { input: event => { story.genre = event.target.value } } })),
        el('label', {}, el('span', { text: uiText('氛围与语气', 'Tone') }), el('input', { maxlength: 1000, value: story.tone, on: { input: event => { story.tone = event.target.value } } })),
      ),
      el('label', {}, el('span', { text: uiText('玩家身份', 'Player role') }), el('textarea', { rows: 3, maxlength: 5000, value: story.player_role, on: { input: event => { story.player_role = event.target.value } } })),
      el('div', { class: 'form-row' },
        el('label', {}, el('span', { text: uiText('封面地址', 'Cover URL') }), el('input', { type: 'url', maxlength: 200000, value: story.cover_url, placeholder: 'https://…', on: { input: event => { story.cover_url = event.target.value } } })),
        el('label', {}, el('span', { text: uiText('可见性', 'Visibility') }), el('select', { value: story.visibility, on: { change: event => { story.visibility = event.target.value } } },
          el('option', { value: 'private', text: uiText('私有', 'Private') }),
          el('option', { value: 'unlisted', text: uiText('不公开列出', 'Unlisted') }),
          el('option', { value: 'public', text: uiText('公开', 'Public') }),
        )),
      ),
      el('div', { class: 'form-row' },
        el('label', {}, el('span', { text: uiText('标签', 'Tags') }), el('input', { value: (story.tags || []).join(', '), on: { input: event => { story.tags = event.target.value.split(',').map(item => item.trim()).filter(Boolean) } } })),
        el('label', {}, el('span', { text: uiText('内容提示', 'Content notes') }), el('input', { value: (story.content_warnings || []).join(', '), on: { input: event => { story.content_warnings = event.target.value.split(',').map(item => item.trim()).filter(Boolean) } } })),
      ),
    )

    if (active === 'cast') {
      const used = new Set(story.cast.map(member => member.character_id))
      const available = state.boot.characters.filter(character => !used.has(character.id))
      if (!available.some(character => character.id === selectedCharacterId)) selectedCharacterId = available[0]?.id || ''
      const select = el('select', { value: selectedCharacterId, disabled: !available.length, on: { change: event => { selectedCharacterId = event.target.value } } },
        ...available.map(character => el('option', { value: character.id, text: character.name })),
      )
      const add = () => {
        const character = state.boot.characters.find(item => item.id === selectedCharacterId)
        if (!character) return
        story.cast.push({ character_id: character.id, role: '', public_context: '', private_context: '', metadata: {}, character })
        castMetadataSources.set(character.id, '{}')
        selectedCharacterId = ''
        markDirty(); redraw()
      }
      return el('div', { class: 'editor-section' },
        el('div', { class: 'editor-section-heading' }, el('div', {}, el('h3', { text: uiText('谁在这个故事中行动', 'Who acts in this Story') }), el('p', { text: uiText('可以添加任意数量的现有角色，调整顺序，并分别维护公开与私人上下文。', 'Add any number of existing Characters, reorder them, and maintain public and private context separately.') }))),
        el('div', { class: 'editor-add-row' }, select, el('button', { type: 'button', class: 'secondary', disabled: !available.length, text: uiText('加入角色', 'Add Character'), on: { click: add } })),
        el('div', { class: 'editor-collection' }, ...story.cast.map((member, index) => el('article', { class: 'editor-item' },
          el('div', { class: 'editor-item-heading' },
            el('div', { class: 'editor-person' }, avatar(member.character, 'md'), el('div', {}, el('strong', { text: member.character.name }), el('small', { text: member.character.description || uiText('角色内容可在角色工作台单独编辑。', 'Character content is editable in its own workspace.') }))),
            el('div', { class: 'editor-item-actions' },
              el('button', { type: 'button', class: 'secondary compact', disabled: index === 0, title: uiText('上移', 'Move up'), text: '↑', on: { click: () => { story.cast.splice(index - 1, 0, story.cast.splice(index, 1)[0]); markDirty(); redraw() } } }),
              el('button', { type: 'button', class: 'secondary compact', disabled: index === story.cast.length - 1, title: uiText('下移', 'Move down'), text: '↓', on: { click: () => { story.cast.splice(index + 1, 0, story.cast.splice(index, 1)[0]); markDirty(); redraw() } } }),
              el('button', { type: 'button', class: 'danger compact', disabled: story.cast.length === 1, text: uiText('移除', 'Remove'), on: { click: () => { if (story.cast.length === 1) return; story.cast.splice(index, 1); castMetadataSources.delete(member.character_id); markDirty(); redraw() } } }),
            ),
          ),
          el('label', {}, el('span', { text: uiText('故事角色定位', 'Role in this Story') }), el('input', { maxlength: 1000, value: member.role, on: { input: event => { member.role = event.target.value } } })),
          el('div', { class: 'form-row' },
            el('label', {}, el('span', { text: uiText('所有人可知', 'Public context') }), el('textarea', { rows: 4, maxlength: 10000, value: member.public_context, on: { input: event => { member.public_context = event.target.value } } })),
            el('label', {}, el('span', { text: uiText('仅该角色可知', 'Private context') }), el('textarea', { rows: 4, maxlength: 10000, value: member.private_context, on: { input: event => { member.private_context = event.target.value } } })),
          ),
          el('details', { class: 'advanced-details' }, el('summary', { text: 'Cast metadata JSON' }), el('textarea', { class: 'json-editor', rows: 6, spellcheck: false, value: castMetadataSources.get(member.character_id) || '{}', on: { input: event => { castMetadataSources.set(member.character_id, event.target.value) } } })),
        ))),
      )
    }

    if (active === 'world') {
      story.lore ||= []
      const addLore = () => {
        const id = nextEditorKey('lore', story.lore)
        story.lore.push({ id, title: uiText('新的知识条目', 'New lore entry'), content: '', keywords: [], visibility: 'public' })
        markDirty(); redraw()
      }
      return el('div', { class: 'editor-section' },
        el('div', { class: 'editor-section-heading' }, el('div', {}, el('h3', { text: uiText('世界承诺与知识边界', 'World promises and knowledge boundaries') }), el('p', { text: uiText('世界规则约束叙事；每条 Lore 都有明确可见范围。', 'World rules constrain narration; every Lore entry has an explicit audience.') }))),
        el('label', {}, el('span', { text: uiText('开场情况', 'Opening situation') }), el('textarea', { required: true, rows: 7, maxlength: 30000, value: story.opening_scene, on: { input: event => { story.opening_scene = event.target.value } } })),
        el('label', {}, el('span', { text: uiText('世界规则（每行一条）', 'World rules — one per line') }), el('textarea', { rows: 7, value: (story.world_rules || []).join('\n'), on: { input: event => { story.world_rules = lines(event.target.value) } } })),
        el('div', { class: 'editor-subheading' }, el('div', {}, el('h3', { text: 'Lore' }), el('p', { text: uiText('公开、私人或仅 Director 可见的世界知识。', 'World knowledge can be public, private, or Director-only.') })), el('button', { type: 'button', class: 'secondary compact', text: uiText('＋ 添加 Lore', '＋ Add lore'), on: { click: addLore } })),
        el('div', { class: 'editor-collection' }, ...story.lore.map((entry, index) => el('article', { class: 'editor-item' },
          el('div', { class: 'editor-item-heading' }, el('strong', { text: entry.title || `Lore ${index + 1}` }), el('button', { type: 'button', class: 'danger compact', text: uiText('移除', 'Remove'), on: { click: () => { story.lore.splice(index, 1); markDirty(); redraw() } } })),
          el('div', { class: 'form-row' },
            el('label', {}, el('span', { text: uiText('稳定 Key', 'Stable key') }), el('input', { required: true, maxlength: 120, value: entry.id || entry.key, on: { input: event => { entry.id = event.target.value; delete entry.key } } })),
            el('label', {}, el('span', { text: uiText('标题', 'Title') }), el('input', { maxlength: 300, value: entry.title, on: { input: event => { entry.title = event.target.value } } })),
          ),
          el('div', { class: 'form-row' },
            el('label', {}, el('span', { text: uiText('可见范围', 'Visibility') }), el('select', { value: entry.visibility || 'public', on: { change: event => { entry.visibility = event.target.value } } }, el('option', { value: 'public', text: uiText('公开', 'Public') }), el('option', { value: 'private', text: uiText('角色私人上下文', 'Private') }), el('option', { value: 'director', text: 'Director only' }))),
            el('label', {}, el('span', { text: uiText('关键词', 'Keywords') }), el('input', { value: (entry.keywords || []).join(', '), on: { input: event => { entry.keywords = event.target.value.split(',').map(item => item.trim()).filter(Boolean) } } })),
          ),
          el('label', {}, el('span', { text: uiText('内容', 'Content') }), el('textarea', { rows: 6, maxlength: 10000, value: entry.content, on: { input: event => { entry.content = event.target.value } } })),
          el('label', { class: 'checkbox-field' }, el('input', { type: 'checkbox', checked: Boolean(entry.constant), on: { change: event => { entry.constant = event.target.checked } } }), el('span', { text: uiText('始终加入相关上下文', 'Always include when relevant') })),
        ))),
      )
    }

    if (active === 'scenes') {
      story.scenes ||= []
      const addScene = () => {
        const id = nextEditorKey('scene', story.scenes)
        story.scenes.push({ id, title: uiText('新场景', 'New scene'), location: '', time: '', objective: '', content: '', active_character_ids: story.cast.map(member => member.character_id) })
        markDirty(); redraw()
      }
      return el('div', { class: 'editor-section' },
        el('div', { class: 'editor-section-heading' }, el('div', {}, el('h3', { text: uiText('可到达的故事场景', 'Reachable Story scenes') }), el('p', { text: uiText('场景是可进入的环境，不是要求模型照着执行的固定剧本。', 'Scenes are environments to reach, not a fixed script for the model to execute.') })), el('button', { type: 'button', class: 'secondary compact', text: uiText('＋ 添加场景', '＋ Add scene'), on: { click: addScene } })),
        story.scenes.length ? el('div', { class: 'editor-collection' }, ...story.scenes.map((scene, index) => el('article', { class: 'editor-item' },
          el('div', { class: 'editor-item-heading' }, el('strong', { text: scene.title || `Scene ${index + 1}` }), el('div', { class: 'editor-item-actions' },
            el('button', { type: 'button', class: 'secondary compact', disabled: index === 0, text: '↑', on: { click: () => { story.scenes.splice(index - 1, 0, story.scenes.splice(index, 1)[0]); markDirty(); redraw() } } }),
            el('button', { type: 'button', class: 'secondary compact', disabled: index === story.scenes.length - 1, text: '↓', on: { click: () => { story.scenes.splice(index + 1, 0, story.scenes.splice(index, 1)[0]); markDirty(); redraw() } } }),
            el('button', { type: 'button', class: 'danger compact', text: uiText('移除', 'Remove'), on: { click: () => { story.scenes.splice(index, 1); markDirty(); redraw() } } }),
          )),
          el('div', { class: 'form-row' },
            el('label', {}, el('span', { text: uiText('稳定 Key', 'Stable key') }), el('input', { required: true, maxlength: 120, value: scene.id || scene.key, on: { input: event => { scene.id = event.target.value; delete scene.key } } })),
            el('label', {}, el('span', { text: uiText('场景标题', 'Scene title') }), el('input', { required: true, maxlength: 300, value: scene.title, on: { input: event => { scene.title = event.target.value } } })),
          ),
          el('div', { class: 'form-row' },
            el('label', {}, el('span', { text: uiText('地点', 'Location') }), el('input', { maxlength: 1000, value: scene.location, on: { input: event => { scene.location = event.target.value } } })),
            el('label', {}, el('span', { text: uiText('时间', 'Time') }), el('input', { maxlength: 1000, value: scene.time, on: { input: event => { scene.time = event.target.value } } })),
          ),
          el('label', {}, el('span', { text: uiText('场景目标或压力', 'Scene objective or pressure') }), el('textarea', { rows: 4, maxlength: 10000, value: scene.objective, on: { input: event => { scene.objective = event.target.value } } })),
          el('label', {}, el('span', { text: 'Markdown Scene' }), el('textarea', { rows: 8, maxlength: 100000, value: scene.content || '', on: { input: event => { scene.content = event.target.value } } })),
          el('fieldset', { class: 'editor-checklist' }, el('legend', { text: uiText('活跃角色', 'Active Characters') }), ...story.cast.map(member => el('label', { class: 'checkbox-field' }, el('input', { type: 'checkbox', checked: (scene.active_character_ids || []).includes(member.character_id), on: { change: event => {
            const activeIds = new Set(scene.active_character_ids || [])
            if (event.target.checked) activeIds.add(member.character_id); else activeIds.delete(member.character_id)
            scene.active_character_ids = [...activeIds]
          } } }), el('span', { text: member.character.name })))),
        ))) : el('div', { class: 'editor-empty' }, el('p', { text: uiText('当前故事没有场景文件；开场情况仍然可以启动故事。', 'This Story has no scene files yet; the opening situation can still begin play.') })),
      )
    }

    if (active === 'causality') return el('div', { class: 'editor-section' },
      el('div', { class: 'editor-section-heading' }, el('div', {}, el('h3', { text: uiText('事实、行动与持续意图', 'Facts, Actions, and durable Intent') }), el('p', { text: uiText('这里编辑真正决定因果行为的结构化定义；每个 JSON 区域都会在保存前验证。', 'These structured definitions determine causal behavior. Every JSON section is validated before saving.') }))),
      el('label', {}, el('span', { text: 'Initial State JSON' }), el('textarea', { class: 'json-editor', rows: 12, spellcheck: false, value: jsonSources.initial_state, on: { input: event => { jsonSources.initial_state = event.target.value } } })),
      el('label', {}, el('span', { text: 'World Schema JSON' }), el('textarea', { class: 'json-editor', rows: 10, spellcheck: false, value: jsonSources.world_schema, on: { input: event => { jsonSources.world_schema = event.target.value } } })),
      el('label', {}, el('span', { text: 'Actions JSON' }), el('textarea', { class: 'json-editor', rows: 16, spellcheck: false, value: jsonSources.actions, on: { input: event => { jsonSources.actions = event.target.value } } })),
      el('label', {}, el('span', { text: 'Agendas JSON' }), el('textarea', { class: 'json-editor', rows: 16, spellcheck: false, value: jsonSources.agendas, on: { input: event => { jsonSources.agendas = event.target.value } } })),
      el('label', {}, el('span', { text: 'State Visibility JSON' }), el('textarea', { class: 'json-editor', rows: 10, spellcheck: false, value: jsonSources.state_visibility, on: { input: event => { jsonSources.state_visibility = event.target.value } } })),
      el('label', {}, el('span', { text: 'Prompt Graph JSON' }), el('textarea', { class: 'json-editor', rows: 10, spellcheck: false, value: jsonSources.prompt_graph, on: { input: event => { jsonSources.prompt_graph = event.target.value } } })),
    )

    return el('div', { class: 'editor-section' },
      el('div', { class: 'editor-section-heading' }, el('div', {}, el('h3', { text: uiText('创作者与文件级控制', 'Creator and file-level control') }), el('p', { text: uiText('普通编辑器覆盖完整运行时模型；标准 Story Source 仍是最底层的可移植创作格式。', 'The visual editor covers the complete runtime model; the standard Story source remains the lowest-level portable authoring format.') }))),
      el('div', { class: 'source-status' }, el('div', {}, el('strong', { text: `${loaded.binding.story_key} · ${loaded.binding.kind}` }), el('small', { text: loaded.binding.path })), el('span', { class: 'status-pill active', text: uiText('已绑定标准文件', 'Bound source') })),
      el('label', {}, el('span', { text: uiText('创作者备注', 'Author notes') }), el('textarea', { rows: 8, maxlength: 30000, value: story.author_notes, on: { input: event => { story.author_notes = event.target.value } } })),
      el('label', {}, el('span', { text: 'Metadata JSON' }), el('textarea', { class: 'json-editor', rows: 12, spellcheck: false, value: jsonSources.metadata, on: { input: event => { jsonSources.metadata = event.target.value } } })),
      el('label', {}, el('span', { text: 'Share Policy JSON' }), el('textarea', { class: 'json-editor', rows: 10, spellcheck: false, value: jsonSources.share_policy, on: { input: event => { jsonSources.share_policy = event.target.value } } })),
      el('div', { class: 'editor-notice' },
        el('strong', { text: uiText('需要直接控制文件资源？', 'Need direct file-level control?') }),
        el('p', { text: uiText('原始编辑器允许修改 Character Card、Lorebook、Markdown Scene、Action、Agenda 和稳定 Key。', 'The source editor can directly modify Character Cards, Lorebooks, Markdown Scenes, Actions, Agendas, and stable keys.') }),
        el('button', { type: 'button', class: 'secondary', text: uiText('打开完整 Story Source', 'Open complete Story source'), on: { click: async () => {
          if (editor.dirty && !confirm(uiText('当前可视化修改尚未保存。放弃这些修改并打开源文件？', 'Visual changes are not saved. Discard them and open the source?'))) return
          await openStorySourceEditor({ id: story.id, title: story.title })
        } } }),
      ),
    )
  }

  editor = openContentEditor({
    modalTitle: uiText('编辑故事', 'Edit Story'),
    eyebrow: uiText('故事工作台', 'Story workspace'),
    title: story.title,
    summary: uiText('从玩家入口到角色私有知识、场景文件和因果规则，所有创作内容都可以修改。', 'Edit everything from the player invitation to cast secrets, scene files, and causal rules.'),
    tabs,
    renderPanel,
    headerAside: castStack(story.cast, 'md'),
    onSave: async () => {
      if (!String(story.title || '').trim()) throw new Error(uiText('故事标题不能为空。', 'Story title is required.'))
      if (!String(story.opening_scene || '').trim()) throw new Error(uiText('故事需要一个开场情况。', 'The Story requires an opening situation.'))
      if (!story.cast.length) throw new Error(uiText('故事至少需要一个角色。', 'The Story requires at least one cast member.'))
      const characterIds = story.cast.map(member => member.character_id)
      if (new Set(characterIds).size !== characterIds.length) throw new Error(uiText('同一个角色不能在阵容中出现两次。', 'The same Character cannot appear in the cast twice.'))
      story.initial_state = parseEditorJson(jsonSources.initial_state, 'Initial State')
      story.metadata = parseEditorJson(jsonSources.metadata, 'Metadata')
      story.share_policy = parseEditorJson(jsonSources.share_policy, 'Share Policy')
      story.runtime = {
        world_schema: parseEditorJson(jsonSources.world_schema, 'World Schema'),
        actions: parseEditorJson(jsonSources.actions, 'Actions', { array: true }),
        agendas: parseEditorJson(jsonSources.agendas, 'Agendas', { array: true }),
        prompt_graph: parseEditorJson(jsonSources.prompt_graph, 'Prompt Graph'),
        state_visibility: parseEditorJson(jsonSources.state_visibility, 'State Visibility', { array: true }),
      }
      const payload = {
        title: story.title,
        hook: story.hook,
        summary: story.summary,
        premise: story.premise,
        genre: story.genre,
        tone: story.tone,
        opening_scene: story.opening_scene,
        player_role: story.player_role,
        world_rules: story.world_rules || [],
        lore: story.lore || [],
        initial_state: story.initial_state,
        author_notes: story.author_notes,
        content_warnings: story.content_warnings || [],
        tags: story.tags || [],
        cover_url: story.cover_url,
        visibility: story.visibility,
        scenes: story.scenes || [],
        metadata: story.metadata,
        share_policy: story.share_policy,
        runtime: story.runtime,
        cast: story.cast.map(member => ({
          character_id: member.character_id,
          role: member.role,
          public_context: member.public_context,
          private_context: member.private_context,
          metadata: parseEditorJson(castMetadataSources.get(member.character_id) || '{}', `${member.character.name} cast metadata`),
        })),
      }
      loaded = await api(`/api/creator/stories/${encodeURIComponent(storyId)}`, {
        method: 'PUT',
        body: JSON.stringify({ story: payload, expected_digest: loaded.binding.digest }),
      })
      story = structuredClone(loaded.story)
      resetJsonSources()
      await refresh()
      return { title: story.title }
    },
  })
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
  renderCausalInspector()
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

function displayValue(value) {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function factRows(value, prefix = '', depth = 0) {
  if (!value || typeof value !== 'object' || depth > 3) return []
  const rows = []
  for (const [key, nested] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) rows.push(...factRows(nested, path, depth + 1))
    else rows.push(el('div', { class: 'fact-row' }, el('span', { text: path }), el('strong', { text: displayValue(nested) })))
  }
  return rows
}

function inspectorSection(title, ...children) {
  return el('section', { class: 'inspector-section' }, el('h3', { text: title }), ...children.filter(Boolean))
}

function renderCausalInspector() {
  const view = state.conversation
  if (!view) return
  const causal = view.causal || {}
  $('#stateRevision').textContent = `State ${causal.state_revision || 0}`
  $$('#inspectorTabs button').forEach(button => button.classList.toggle('active', button.dataset.inspectorTab === state.inspectorTab))
  const body = clear($('#inspectorBody'))
  if (state.inspectorTab === 'facts') {
    const scene = view.journal?.current_scene
    if (scene) body.append(inspectorSection('Current scene', el('div', { class: 'fact-tree' }, ...factRows(scene))))
    if (Object.keys(causal.clocks || {}).length) body.append(inspectorSection('Clocks', el('div', { class: 'fact-tree' }, ...factRows(causal.clocks))))
    if ((causal.known_facts || []).length) {
      body.append(inspectorSection('Player-known facts', ...(causal.known_facts || []).slice(-20).map(item =>
        el('div', { class: 'intent-row' }, el('strong', { text: typeof item === 'string' ? item : item.content || item.title || displayValue(item) })),
      )))
    }
    if ((causal.recent_observations || []).length) {
      body.append(inspectorSection('Observed', ...(causal.recent_observations || []).slice(-12).reverse().map(item =>
        el('div', { class: 'intent-row' }, el('strong', { text: item.content }), el('small', { text: item.kind || 'observation' })),
      )))
    }
  } else if (state.inspectorTab === 'actions') {
    body.append(...(causal.recent_receipts || []).slice().reverse().map(receipt => el('article', { class: `receipt-card ${receipt.status === 'rejected' ? 'rejected' : ''}` },
      el('strong', { text: `${receipt.status === 'rejected' ? 'Blocked' : 'Resolved'} · ${receipt.action_type || 'action'}` }),
      el('small', { text: receipt.reason || receipt.outcome || `${receipt.changed_fact_count || 0} fact change(s)` }),
    )))
  } else if (state.inspectorTab === 'intent') {
    body.append(...(causal.active_agendas || []).map(agenda => el('article', { class: 'intent-row' },
      el('strong', { text: agenda.objective || agenda.id }),
      el('small', { text: `${actorFor(agenda.owner_id).name} · priority ${agenda.priority ?? 50} · evaluated ${agenda.evaluation_count || 0} time(s)` }),
    )))
    const loop = causal.latest_loop
    if (loop) body.append(inspectorSection('Control loop', el('div', { class: `receipt-card ${loop.status === 'suspended' ? 'rejected' : ''}` },
      el('strong', { text: `${loop.status} · ${loop.phase}` }),
      el('small', { text: `${loop.step_count || 0} durable step(s)` }),
      loop.status === 'suspended' ? el('button', { class: 'secondary compact', text: 'Resume safely', on: { click: () => resumeControlLoop(loop.id) } }) : null,
    )))
  } else {
    body.append(inspectorSection('Timelines', ...(view.branches || []).map(branch =>
      el('div', { class: 'intent-row' }, el('strong', { text: branch.label }), el('small', { text: branch.id === view.conversation.current_branch_id ? 'Current timeline' : 'Alternative timeline' })),
    )))
    const manifest = causal.latest_loop?.context_manifests?.control
    if (manifest) body.append(inspectorSection('Context assembly',
      el('div', { class: 'fact-tree' },
        el('div', { class: 'fact-row' }, el('span', { text: 'Policy' }), el('strong', { text: manifest.policy })),
        el('div', { class: 'fact-row' }, el('span', { text: 'Whole blocks' }), el('strong', { text: `${manifest.included_count || 0} included · ${manifest.omitted_count || 0} omitted` })),
        el('div', { class: 'fact-row' }, el('span', { text: 'Truncated blocks' }), el('strong', { text: String(manifest.truncated_blocks || 0) })),
      ),
    ))
  }
  if (!body.childNodes.length) body.append(el('div', { class: 'inspector-empty' }, el('p', { text: state.inspectorTab === 'intent' ? 'No public character intent is exposed yet. Private intent stays private.' : 'This view will fill as actions are resolved and consequences are observed.' })))
}

function showCausalPulse(receipt) {
  const pulse = $('#causalPulse')
  pulse.textContent = receipt.status === 'rejected' ? `Action blocked: ${receipt.reason || receipt.action_type}` : `Fact committed: ${receipt.action_type || receipt.outcome}`
  pulse.classList.remove('hidden')
  clearTimeout(showCausalPulse.timer)
  showCausalPulse.timer = setTimeout(() => pulse.classList.add('hidden'), 4200)
}

function toggleCausalInspector() {
  const inspector = $('#causalInspector')
  const workspace = $('.story-workspace')
  if (matchMedia('(max-width: 900px)').matches) {
    inspector.classList.toggle('open')
    return
  }
  state.inspectorOpen = !state.inspectorOpen
  inspector.classList.toggle('collapsed', !state.inspectorOpen)
  workspace.classList.toggle('inspector-hidden', !state.inspectorOpen)
}

async function resumeControlLoop(loopId) {
  try {
    state.streaming = true
    $('#typing').classList.remove('hidden')
    await api(`/api/control-loops/${encodeURIComponent(loopId)}/resume`, { method: 'POST', body: '{}' })
    await refresh({ preserveView: false })
    await openConversation(state.conversationId)
    toast('The saved command completed.')
  } catch (error) { toast(error.message, 7000) }
  finally { state.streaming = false; $('#typing').classList.add('hidden') }
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
      if (event === 'action.receipt') showCausalPulse(data)
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
    await openConversation(state.conversationId)
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
      el('label', { class: 'field' }, el('span', { text: t('historyMessages') }), el('input', { name: 'history_messages', type: 'number', min: 0, max: 10000, step: 1, value: conversation.prompt.history_messages ?? '', placeholder: localText('留空 = 全部历史', 'Blank = all history') }), el('small', { text: localText('留空时 Tavern 不设消息数量上限，由模型服务处理上下文。', 'Leave blank for no Tavern message-count ceiling; the model service manages its context.') })),
      el('label', { class: 'field' }, el('span', { text: localText('显式上下文预算（可选）', 'Explicit context budget (optional)') }), el('input', { name: 'context_budget_tokens', type: 'number', min: 512, max: 10000000, step: 1, value: conversation.prompt.context_budget_tokens ?? '', placeholder: localText('留空 = 不设置', 'Blank = no Tavern ceiling') }), el('small', { text: localText('仅在你主动填写时启用；超预算时按完整信息块取舍，绝不截断文字。', 'Only active when you set it. Whole context blocks are selected; text is never cut mid-block.') })),
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
        history_messages: form.elements.history_messages.value === '' ? null : Number(form.elements.history_messages.value),
        context_budget_tokens: form.elements.context_budget_tokens.value === '' ? null : Number(form.elements.context_budget_tokens.value),
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
      `${t('historyMessages')}: ${settings.prompt.history_messages ?? localText('全部', 'All')}`,
      settings.prompt.context_budget_tokens ? localText(`上下文预算: ${settings.prompt.context_budget_tokens}`, `Context budget: ${settings.prompt.context_budget_tokens}`) : localText('无 Tavern 上下文硬上限', 'No Tavern context ceiling'),
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
  const presetSettingNames = new Set(['thinking_intensity', 'response_length', 'initiative', 'pacing', 'frequency_penalty', 'presence_penalty', 'top_k', 'min_p', 'repetition_penalty', 'seed', 'stop_sequences', 'provider_options', 'custom_instructions', 'history_messages', 'context_budget_tokens'])
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
  const portability = el('section', { class: 'drawer-section' },
    el('h3', { text: 'Portable playthrough' }),
    el('p', { text: 'Download this Story, cast, causal facts and visible event history as one independent Tavern file. API credentials are excluded.' }),
    el('button', { class: 'secondary', text: 'Export playthrough', on: { click: async () => downloadJson(await api(`/api/exports/conversations/${encodeURIComponent(conversation.id)}`), `${conversation.title}.playthrough.tavern.json`) } }),
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
  const body = el('div', {}, timelines, portability, danger)
  openDrawer(t('more'), body)
}

async function switchTimeline(branchId) {
  await api(`/api/conversations/${encodeURIComponent(state.conversationId)}/branches/${encodeURIComponent(branchId)}/switch`, { method: 'POST' })
  closeDrawer()
  await openConversation(state.conversationId)
}

function openNewContent() {
  const definitions = state.boot.content_types || []
  const labels = {
    character: {
      icon: '✦',
      title: uiText('空白角色', 'Blank Character'),
      description: uiText('只建立结构和名称，然后进入完整角色编辑器。', 'Create only its identity and structure, then open the complete Character editor.'),
      open: openBlankCharacter,
    },
    story: {
      icon: '◇',
      title: uiText('空白故事', 'Blank Story'),
      description: uiText('选择初始角色阵容并建立标准 Story v2 文件；不生成题材、情节或文字。', 'Choose the initial Cast and create a standard Story v2 file. No genre, plot, or prose is generated.'),
      open: openBlankStory,
    },
  }
  const options = definitions.map(definition => {
    const copy = labels[definition.kind]
    if (!copy) return null
    return el('button', { type: 'button', class: 'new-content-option', on: { click: copy.open } },
      el('span', { class: 'new-content-icon', text: copy.icon, 'aria-hidden': 'true' }),
      el('span', { class: 'new-content-copy' }, el('strong', { text: copy.title }), el('small', { text: copy.description })),
      el('span', { class: 'new-content-arrow', text: '→', 'aria-hidden': 'true' }),
    )
  }).filter(Boolean)
  options.push(el('button', { type: 'button', class: 'new-content-option', on: { click: () => { closeModal(); openImportDialog() } } },
    el('span', { class: 'new-content-icon', text: '↥', 'aria-hidden': 'true' }),
    el('span', { class: 'new-content-copy' }, el('strong', { text: uiText('导入标准文件', 'Import standard content') }), el('small', { text: uiText('预览 Character Card、Story Source、Tavern Pack 或 SillyTavern 数据后再写入。', 'Preview a Character Card, Story source, Tavern pack, or SillyTavern data before writing it.') })),
    el('span', { class: 'new-content-arrow', text: '→', 'aria-hidden': 'true' }),
  ))
  openModal(uiText('加入内容库', 'Add to Library'), el('div', { class: 'new-content-shell' },
    el('p', { class: 'new-content-principle', text: uiText('Harness Tavern 只建立你明确选择的结构，不会用固定 Prompt 替你补写内容。', 'Harness Tavern creates only the structure you explicitly choose. It does not expand a brief with a fixed prompt.') }),
    el('div', { class: 'new-content-list' }, ...options),
  ), { autoFocus: false })
}

function openBlankCharacter() {
  const form = el('form', { class: 'friendly-form blank-content-form' },
    el('p', { text: uiText('这里只需要一个名称。其余字段保持为空，并在创建后由完整角色编辑器管理。', 'Only a name is required here. Every other field stays empty and is managed by the complete editor after creation.') }),
    el('label', {}, el('span', { text: uiText('角色名称', 'Character name') }), el('input', { name: 'name', required: true, maxlength: 120, autocomplete: 'off' })),
    el('button', { type: 'submit', text: uiText('建立空白角色', 'Create blank Character') }),
  )
  form.addEventListener('submit', async event => {
    event.preventDefault()
    const button = form.querySelector('button[type="submit"]')
    button.disabled = true
    try {
      const values = formObject(form)
      const result = await api('/api/library/items', { method: 'POST', body: JSON.stringify({ kind: 'character', content: { name: values.name } }) })
      closeModal()
      await refresh()
      state.libraryTab = 'characters'
      showView('library')
      await openCharacterEditor(result.item.id)
    } catch (error) { button.disabled = false; toast(error.message, 7000) }
  })
  openModal(uiText('空白角色', 'Blank Character'), form)
}

function openBlankStory() {
  const characters = state.boot.characters
  if (!characters.length) {
    return openModal(uiText('空白故事', 'Blank Story'), el('div', { class: 'friendly-form' },
      el('p', { text: uiText('Story Source 至少需要一个明确的角色引用。请先建立或导入角色。', 'A Story source needs at least one explicit Character reference. Add or import a Character first.') }),
      el('button', { type: 'button', text: uiText('先建立角色', 'Create a Character first'), on: { click: openBlankCharacter } }),
    ))
  }
  const cast = el('fieldset', { class: 'new-content-cast' },
    el('legend', { text: uiText('初始角色阵容', 'Initial Cast') }),
    ...characters.map(character => el('label', { class: 'checkbox-field' },
      el('input', { type: 'checkbox', name: 'character_id', value: character.id }),
      avatar(character, 'sm'),
      el('span', {}, el('strong', { text: character.name }), el('small', { text: character.description || uiText('没有公开描述', 'No public description') })),
    )),
  )
  const form = el('form', { class: 'friendly-form blank-content-form' },
    el('p', { text: uiText('只建立标题、角色引用和空的标准结构；情节、语气、场景与因果规则均由你在完整编辑器或源文件中明确填写。', 'This creates only a title, Character references, and an empty standard structure. You explicitly author plot, tone, Scenes, and causal rules in the editor or source file.') }),
    el('label', {}, el('span', { text: uiText('故事标题', 'Story title') }), el('input', { name: 'title', required: true, maxlength: 200, autocomplete: 'off' })),
    cast,
    el('button', { type: 'submit', text: uiText('建立空白故事文件', 'Create blank Story file') }),
  )
  form.addEventListener('submit', async event => {
    event.preventDefault()
    const selected = [...form.querySelectorAll('input[name="character_id"]:checked')].map(input => input.value)
    if (!selected.length) return toast(uiText('请至少选择一个角色。', 'Choose at least one Character.'))
    const button = form.querySelector('button[type="submit"]')
    button.disabled = true
    try {
      const values = formObject(form)
      const result = await api('/api/library/items', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'story',
          content: {
            title: values.title,
            cast: selected.map(characterId => ({ character_id: characterId, role: '', public_context: '', private_context: '', metadata: {} })),
          },
        }),
      })
      closeModal()
      await refresh()
      state.libraryTab = 'stories'
      showView('library')
      await openStoryEditor(result.item.id)
    } catch (error) { button.disabled = false; toast(error.message, 7000) }
  })
  openModal(uiText('空白故事', 'Blank Story'), form, { wide: true })
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
      el('small', { text: 'Tavern packs, playthroughs, backups, Story source, and SillyTavern JSON/PNG/CHARX/ZIP are supported.' }),
    ),
    el('button', { type: 'button', class: 'file-drop secondary-project-drop', on: { click: () => $('#storyProjectFiles').click() } },
      el('span', { class: 'choice-icon', text: '▦' }),
      el('strong', { text: 'Choose a Story project folder' }),
      el('small', { text: 'Imports story.tavern.json together with relative Character, Lorebook and Markdown scene files.' }),
    ),
    el('button', { type: 'button', class: 'file-drop secondary-project-drop', on: { click: () => $('#sillyTavernFiles').click() } },
      el('span', { class: 'choice-icon', text: '↬' }),
      el('strong', { text: 'Migrate a SillyTavern data folder' }),
      el('small', { text: 'Previews Characters, Chats, Group Chats, Groups, Worlds, Personas and presets before importing. secrets.json is always excluded.' }),
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
  const imported = await api('/api/import/apply', { method: 'POST', body: JSON.stringify({ content: state.importContent, strategy, source_name: 'Tavern UI import' }) })
  state.importContent = null
  closeModal(); await refresh(); showView('library')
  const warningCount = imported.result?.source_sync_warnings?.length ?? 0
  toast(warningCount
    ? localText(`已导入，但有 ${warningCount} 个可编辑源文件需要修复；请运行 doctor。`, `Imported, but ${warningCount} editable source file(s) need repair; run doctor.`)
    : t('imported'))
}

function fileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}`))
    reader.onload = () => resolve(String(reader.result).split(',').at(-1))
    reader.readAsDataURL(file)
  })
}

async function sillyTavernPayload(files, sourceName) {
  const entries = []
  for (const file of files) {
    const path = file.webkitRelativePath || file.name
    const binary = /\.(png|charx|zip|webp|jpe?g|gif|mp3|mp4|wav|ogg)$/i.test(path)
    entries.push(binary ? { path, base64: await fileBase64(file) } : { path, text: await file.text() })
  }
  return { source_name: sourceName, files: entries }
}

async function previewSillyTavernMigration(payload) {
  const session = await api('/api/migrations/sillytavern/preview', { method: 'POST', body: JSON.stringify(payload) })
  state.migrationId = session.id
  const counts = session.inventory.counts
  const body = el('div', {},
    el('div', { class: 'import-preview' },
      el('p', { class: 'eyebrow', text: 'Migration preview · nothing changed yet' }),
      el('h3', { text: session.source_name }),
      el('p', { text: `${counts.characters} characters · ${counts.worlds} worlds · ${counts.groups} groups · ${counts.chats} chats · ${counts.personas} Personas · ${counts.presets} presets` }),
      ...(session.warnings || []).map(message => el('p', { class: 'compatibility-warning', text: message })),
      counts.passive_items ? el('p', { class: 'microcopy', text: `${counts.passive_items} theme, extension, Quick Reply, asset or vector item(s) were inventoried without executing code.` }) : null,
    ),
    el('div', { class: 'profile-actions' },
      el('button', { text: 'Create migrated copies', on: { click: () => applySillyTavernMigration('copy') } }),
      el('button', { class: 'secondary', text: 'Replace matching library items', on: { click: () => applySillyTavernMigration('replace') } }),
    ),
  )
  openModal('Review SillyTavern migration', body, { wide: true, autoFocus: false })
}

async function applySillyTavernMigration(strategy) {
  const result = await api(`/api/migrations/sillytavern/${encodeURIComponent(state.migrationId)}/apply`, { method: 'POST', body: JSON.stringify({ strategy }) })
  state.migrationId = null
  closeModal()
  await refresh()
  showView('library')
  const counts = result.inventory.counts
  toast(`Migration complete: ${counts.characters} characters, ${counts.groups + counts.worlds} Stories and ${result.result.conversations?.length || 0} chats.`, 7000)
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
    el('p', { text: 'Extensions may contribute optional data blueprints, composer actions, and visual themes. They cannot execute code or silently change core Library creation.' }),
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
          `${counts.story_templates || 0} Story blueprints`,
          `${counts.character_templates || 0} Character blueprints`,
          `${counts.quick_actions || 0} composer actions`,
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
        el('button', { on: { click: () => finish('library') } }, el('span', { text: '↥' }), el('strong', { text: t('openLibrary') })),
      ),
    ))
  }
  const finish = async destination => {
    await api('/api/user-profile', { method: 'PATCH', body: JSON.stringify({ onboarding_complete: true, locale: getLocale() }) })
    layer.classList.add('hidden')
    await refresh()
    if (destination === 'characters' || destination === 'stories') state.libraryTab = destination
    showView('library')
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
  $('#importFile').addEventListener('change', async event => {
    const file = event.target.files[0]
    if (!file) return
    try {
      if (/\.(png|charx|zip|jsonl)$/i.test(file.name) || file.name.toLocaleLowerCase() === 'settings.json') {
        await previewSillyTavernMigration({ source_name: file.name, filename: file.name, data_base64: await fileBase64(file) })
      } else await previewImport(await file.text())
    } finally { event.target.value = '' }
  })
  $('#storyProjectFiles').addEventListener('change', async event => {
    const files = [...event.target.files]
    if (!files.length) return
    try { await previewImport(await storyProjectBundle(files)) } finally { event.target.value = '' }
  })
  $('#sillyTavernFiles').addEventListener('change', async event => {
    const files = [...event.target.files]
    if (!files.length) return
    try { await previewSillyTavernMigration(await sillyTavernPayload(files, files[0].webkitRelativePath.split('/')[0] || 'SillyTavern data')) }
    finally { event.target.value = '' }
  })
  $('#inspectorTabs').addEventListener('click', event => {
    const button = event.target.closest('[data-inspector-tab]')
    if (!button) return
    state.inspectorTab = button.dataset.inspectorTab
    renderCausalInspector()
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
      'open-library': () => showView('library'),
      'new-content': openNewContent,
      'new-chat': () => { state.libraryTab = 'characters'; showView('library') },
      'open-import': () => openImportDialog(),
      'export-library': async () => downloadJson(await api('/api/exports/library'), 'my-tavern-library.tavern.json'),
      'export-backup': async () => downloadJson(await api('/api/exports/backup'), 'harness-tavern-backup.tavern.json'),
      'manage-shares': () => openShareManager(),
      'add-provider': openProviderForm,
      'install-extension': installExtensionDialog,
      'leave-chat': () => showView('chats'),
      'open-cast': openCastDrawer,
      'open-journal': openJournalDrawer,
      'open-model-controls': openModelControlsDrawer,
      'open-chat-more': openChatMoreDrawer,
      'toggle-causal-inspector': toggleCausalInspector,
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
  else if (hash === 'create') showView('library')
  else showView(['home','chats','library','settings'].includes(hash) ? hash : 'home', { updateHash: false })
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
