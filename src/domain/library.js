import { assert, plainObject } from '../util.js'

const CONTENT_TYPES = Object.freeze([
  Object.freeze({
    kind: 'story',
    label: 'Story',
    creation_mode: 'explicit',
    generated: false,
    required_fields: ['title'],
    editable_model: 'harness-tavern-story/v2',
    portable_formats: ['harness-tavern-story/v2', 'harness-tavern-pack', 'chara_card_v2', 'chara_card_v3'],
  }),
])

function explicitContent(input) {
  assert(plainObject(input), 'Library item request must be an object', 400, 'invalid_library_item')
  assert(Object.keys(input).every(key => ['kind', 'content'].includes(key)), 'Library item creation accepts only kind and explicit content. It does not expand briefs, prompts, or creative instructions.', 400, 'explicit_content_required')
  assert(plainObject(input.content), 'An explicit content object is required. Harness Tavern does not generate authored fields from a brief or prompt.', 400, 'explicit_content_required')
  return structuredClone(input.content)
}

export class LibraryService {
  constructor({ repository, storySources }) {
    this.repository = repository
    this.storySources = storySources
  }

  contentTypes() {
    return structuredClone(CONTENT_TYPES)
  }

  add(input = {}) {
    assert(plainObject(input), 'Library item request must be an object', 400, 'invalid_library_item')
    const definition = CONTENT_TYPES.find(item => item.kind === input.kind)
    assert(definition, `Unsupported Library content kind: ${input.kind ?? ''}`, 400, 'unsupported_content_kind')
    const content = explicitContent(input)
    const structuralContent = {
      ...content,
      ...Array.isArray(content.cast) ? {
        cast: content.cast.map(member => ({
          ...member,
          role: member.role ?? '',
          public_context: member.public_context ?? '',
          private_context: member.private_context ?? '',
          metadata: member.metadata ?? {},
        })),
      } : {},
    }
    const item = this.storySources.createRuntimeStory(structuralContent)
    return { kind: definition.kind, item, source: this.storySources.get(item.id).binding }
  }
}

export { CONTENT_TYPES }
