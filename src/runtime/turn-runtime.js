import { assert, id, safeJsonParse, stableStringify } from '../util.js'
import { reduceEvents } from '../domain/projection.js'
import { normalizeEnvelope, operationEvent, validateOperations } from './operations.js'
import { resolveThinkingIntensity } from './thinking.js'

const TRUNCATED_FINISH_REASONS = new Set(['length', 'max_tokens', 'max_token', 'max_output_tokens'])

function outputError(message, code) {
  const error = new Error(message)
  error.status = 502
  error.code = code
  error.expose = true
  return error
}

function finishReasonKey(value) {
  return String(value ?? '').trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_')
}

function wasTruncated(providerResult) {
  return TRUNCATED_FINISH_REASONS.has(finishReasonKey(providerResult?.finishReason))
}

function looksLikeIncompleteJson(value) {
  const source = String(value ?? '').trim()
  return source.startsWith('{') || /^\[\s*(?:\{|\[|")/.test(source)
}

function plainTextEnvelope(value, allowedSpeakerIds) {
  const source = String(value ?? '').trim()
  const marker = source.match(/^\[speaker:([^\]\s]+)\]\s*/i)
  const markedSpeaker = marker?.[1]
  const characterId = allowedSpeakerIds.includes(markedSpeaker)
    ? markedSpeaker
    : allowedSpeakerIds.includes('narrator') ? 'narrator' : allowedSpeakerIds[0]
  return normalizeEnvelope({
    messages: [{ character_id: characterId, content: marker ? source.slice(marker[0].length) : source }],
    state_operations: [],
    internal_summary: '',
  }, { castIds: allowedSpeakerIds })
}

function usagePayload(providerResult, conversation, turnUid, outcome, error = null) {
  return {
    turn_uid: turnUid,
    provider_id: providerResult.providerId,
    model_id: conversation.model_id,
    latency_ms: providerResult.latencyMs,
    usage: providerResult.usage,
    routed_provider: providerResult.routedProvider ?? null,
    finish_reason: providerResult.finishReason ?? null,
    outcome,
    ...error ? { error_code: error.code || 'turn_failed' } : {},
  }
}

function insertUsage(db, { conversation, turnUid, providerResult, outcome, error = null }) {
  const usage = providerResult.usage ?? {}
  db.raw.prepare(`
    INSERT INTO usage_ledger(conversation_id, turn_event_uid, provider_id, model_id, prompt_tokens,
      completion_tokens, reasoning_tokens, total_tokens, cost_usd, raw_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    conversation.id, turnUid, providerResult.providerId, conversation.model_id,
    usage.promptTokens ?? null, usage.completionTokens ?? null,
    usage.reasoningTokens ?? null, usage.totalTokens ?? null,
    usage.costUsd ?? null,
    stableStringify({ ...usage, outcome, finishReason: providerResult.finishReason ?? null, errorCode: error?.code ?? null }),
    new Date().toISOString(),
  )
}

export class TurnRuntime {
  constructor({ db, repository, providers, contextBuilder, logger }) {
    this.db = db
    this.repository = repository
    this.providers = providers
    this.contextBuilder = contextBuilder
    this.logger = logger
    this.running = new Map()
  }

  isRunning(conversationId) { return this.running.has(conversationId) }

  cancel(conversationId) {
    const controller = this.running.get(conversationId)
    if (!controller) return false
    controller.abort(new Error('Cancelled by user'))
    return true
  }

  async run(conversationId, { content, idempotencyKey = null } = {}) {
    if (this.running.has(conversationId)) {
      const error = new Error('A turn is already running for this conversation')
      error.status = 409
      error.code = 'turn_in_progress'
      throw error
    }
    const controller = new AbortController()
    this.running.set(conversationId, controller)
    const turnUid = id('turn')
    let conversation
    let branchId
    let providerResult = null
    let usageCommitted = false
    try {
      assert(typeof content === 'string' && content.trim().length > 0, 'Message content is required')
      content = content.trim()
      conversation = this.repository.getConversation(conversationId)
      branchId = conversation.current_branch_id
      const story = conversation.story_id ? this.repository.getStory(conversation.story_id) : null
      const persona = this.repository.getPersona(conversation.persona_id)
      const cast = this.repository.listConversationCast(conversationId)
      const activeCast = cast.filter(member => !member.muted)
      assert(activeCast.length > 0 || cast.length === 0, 'Every character is quiet. Open Cast and invite at least one character back into the scene.', 409, 'all_cast_muted')
      const eventsBefore = this.repository.events(conversationId, branchId)
      const projectionBefore = reduceEvents(eventsBefore, story?.initial_state ?? {})
      const effectiveIntensity = resolveThinkingIntensity(conversation.thinking_intensity, {
        userMessage: content,
        castSize: activeCast.length || 1,
        hasStory: Boolean(story),
        hasWorldState: Object.keys(projectionBefore.world ?? {}).length > 0,
      })
      const context = this.contextBuilder.build({
        conversation, story, persona, cast: activeCast, projection: projectionBefore,
        userMessage: content, resolvedIntensity: effectiveIntensity,
      })
      const castIds = activeCast.map(member => member.character_id)
      const allowedSpeakerIds = castIds.length ? [...castIds, 'narrator'] : ['assistant']
      providerResult = await this.providers.complete({
        model: conversation.model_id,
        messages: context.messages,
        thinkingIntensity: effectiveIntensity,
        maxOutputTokens: null,
        temperature: conversation.generation?.temperature ?? 0.8,
        topP: conversation.generation?.top_p ?? 1,
        generation: conversation.generation,
        jsonMode: true,
        route: conversation.route,
      }, {
        connectionId: conversation.connection_id,
        accountConnectionId: conversation.account_connection_id,
        signal: controller.signal,
      })
      if (wasTruncated(providerResult)) {
        throw outputError('The AI service stopped before completing its reply. Your message was not added; retry, shorten the included history, or choose a different model.', 'model_output_truncated')
      }
      const parsed = safeJsonParse(providerResult.content)
      let envelope
      let structuredOutput = true
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        if (!String(providerResult.content ?? '').trim() || looksLikeIncompleteJson(providerResult.content)) {
          throw outputError('The AI service returned an incomplete or invalid structured reply. Your message was not added, so it is safe to retry.', 'invalid_model_output')
        }
        envelope = plainTextEnvelope(providerResult.content, allowedSpeakerIds)
        structuredOutput = false
      } else {
        try {
          envelope = normalizeEnvelope(parsed, { castIds: allowedSpeakerIds })
        } catch (error) {
          if (error.code === 'invalid_model_output') {
            error.message = 'The AI service returned a structured reply without any usable character message. Your message was not added, so it is safe to retry.'
            error.expose = true
          }
          throw error
        }
      }
      const operations = validateOperations(envelope.state_operations, { castIds, hasStory: Boolean(story) })
      const committedEvents = this.db.transaction(() => {
        const appended = []
        appended.push(this.db.appendEvent({
          conversationId, branchId, type: 'turn.started',
          payload: { turn_uid: turnUid, configured_thinking_intensity: conversation.thinking_intensity, effective_thinking_intensity: effectiveIntensity },
          idempotencyKey: idempotencyKey ? `${idempotencyKey}:turn` : null,
        }))
        appended.push(this.db.appendEvent({
          conversationId, branchId, type: 'user.message', actorId: 'user',
          payload: { content, metadata: { turn_uid: turnUid } },
          idempotencyKey: idempotencyKey ? `${idempotencyKey}:user` : null,
        }))
        for (const message of envelope.messages) {
          appended.push(this.db.appendEvent({
            conversationId, branchId, type: 'assistant.message', actorId: message.character_id,
            payload: {
              content: message.content,
              metadata: {
                turn_uid: turnUid,
                character_id: message.character_id,
                configured_thinking_intensity: conversation.thinking_intensity,
                effective_thinking_intensity: effectiveIntensity,
                structured_output: structuredOutput,
              },
            },
          }))
        }
        for (const operation of operations) {
          const event = operationEvent(operation)
          if (event) appended.push(this.db.appendEvent({ conversationId, branchId, ...event }))
        }
        appended.push(this.db.appendEvent({
          conversationId, branchId, type: 'model.usage',
          payload: usagePayload(providerResult, conversation, turnUid, 'completed'),
        }))
        appended.push(this.db.appendEvent({
          conversationId, branchId, type: 'turn.completed',
          payload: {
            turn_uid: turnUid, configured_thinking_intensity: conversation.thinking_intensity,
            effective_thinking_intensity: effectiveIntensity, state_operation_count: operations.length,
            internal_summary: envelope.internal_summary, structured_output: structuredOutput,
          },
        }))
        insertUsage(this.db, { conversation, turnUid, providerResult, outcome: 'completed' })
        this.repository.touchConversation(conversationId, envelope.messages.at(-1)?.content ?? content)
        return appended
      })
      usageCommitted = true
      this.logger.info('turn.completed', {
        conversation_id: conversationId, turn_uid: turnUid,
        configured_thinking_intensity: conversation.thinking_intensity,
        effective_thinking_intensity: effectiveIntensity,
        messages: envelope.messages.length, operations: operations.length, latency_ms: providerResult.latencyMs,
      })
      return {
        turn_uid: turnUid,
        thinking_intensity: conversation.thinking_intensity,
        effective_thinking_intensity: effectiveIntensity,
        messages: envelope.messages,
        state_operations: operations,
        usage: providerResult.usage,
        provider_id: providerResult.providerId,
        routed_provider: providerResult.routedProvider ?? null,
        structured_output: structuredOutput,
        events: committedEvents,
      }
    } catch (error) {
      if (conversation && branchId) {
        try {
          this.db.transaction(() => {
            if (providerResult && !usageCommitted) {
              this.db.appendEvent({
                conversationId, branchId, type: 'model.usage',
                payload: usagePayload(providerResult, conversation, turnUid, 'failed', error),
              })
              insertUsage(this.db, { conversation, turnUid, providerResult, outcome: 'failed', error })
            }
            this.db.appendEvent({
              conversationId, branchId, type: 'turn.failed',
              payload: {
                turn_uid: turnUid,
                error: error.message,
                error_code: error.code || 'turn_failed',
                cancelled: controller.signal.aborted,
                user_message_committed: false,
              },
            })
          })
          this.repository.touchConversation(conversationId)
        } catch {}
      }
      this.logger.warn('turn.failed', { conversation_id: conversationId, turn_uid: turnUid, error: error.message })
      throw error
    } finally {
      this.running.delete(conversationId)
    }
  }
}
