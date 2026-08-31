import { assert, cleanText, id, json, stableStringify } from '../util.js'
import { reduceEvents, visibleObservations } from '../domain/projection.js'
import { ActionRegistry, agendaLifecycleTransition, normalizeStoryAgendas } from './action-registry.js'
import {
  narrationAutonomyConflict,
  narrationContradiction,
  narrationPrivateLeak,
  normalizeCharacterPlan,
  normalizeControlPlan,
  normalizeSceneOutput,
  safeJsonObject,
} from './contracts.js'
import { initialCharacterRuntimeState } from './character-runtime.js'
import { resolveThinkingIntensity } from './thinking.js'
import { applyStoryTransforms } from './story-runtime.js'

const TRUNCATED_FINISH_REASONS = new Set([
  'length', 'max_tokens', 'max_token', 'max_output_tokens', 'model_context_window_exceeded',
])
const MAX_CONTROL_STEPS = 32

function explicitlyRequestsEnsemble(value) {
  return /\b(all|everyone|each|together|the whole group)\b|所有|每个人|全员|大家|一起/iu.test(String(value ?? ''))
}

function participantLimit(pacing, castSize, userMessage) {
  if (explicitlyRequestsEnsemble(userMessage)) return castSize
  if (pacing === 'focused') return Math.min(1, castSize)
  if (pacing === 'ensemble') return Math.min(3, castSize)
  return Math.min(2, castSize)
}

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

function usagePayload(providerResult, conversation, turnUid, phase, outcome, error = null) {
  return {
    turn_uid: turnUid,
    phase,
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

function insertUsage(db, { conversation, turnUid, providerResult, phase, outcome, error = null }) {
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
    stableStringify({ ...usage, phase, outcome, finishReason: providerResult.finishReason ?? null, errorCode: error?.code ?? null, promptCharacters: providerResult.promptCharacters ?? null }),
    new Date().toISOString(),
  )
}

function addUsage(total, result) {
  const usage = result?.usage ?? {}
  for (const key of ['promptTokens', 'completionTokens', 'reasoningTokens', 'totalTokens', 'costUsd']) {
    if (usage[key] !== undefined && usage[key] !== null) total[key] = Number(total[key] ?? 0) + Number(usage[key])
  }
  return total
}

function canonicalNarration(observations) {
  return observations.map(observation => String(observation?.content ?? '').trim()).filter(Boolean).join(' ')
    || 'Nothing in the verified state changes.'
}

function transformedSceneOutput({ story, raw, participantIds, characterPlans, cast, narratorActorId }) {
  const normalized = normalizeSceneOutput(raw, { participantIds, characterPlans, cast })
  const blocks = normalized.scene_blocks.map(block => ({
    ...block,
    content: applyStoryTransforms(story, 'model_output', block.content, {
      actorId: block.character_id ?? narratorActorId,
      cast,
    }),
  }))
  return normalizeSceneOutput({ blocks }, { participantIds, characterPlans, cast })
}

export function rollContinuitySummary(previous, { turnNumber, userMessage, narration, observations = [] } = {}) {
  const observed = observations.map(item => cleanText(item?.content, 500)).filter(Boolean).join(' ')
  const parts = [
    `[Beat ${Number(turnNumber) || 1}] Player: ${cleanText(userMessage, 800)}`,
    observed ? `Verified outcome: ${cleanText(observed, 1200)}` : '',
    narration ? `Story: ${cleanText(narration, 1400)}` : '',
  ].filter(Boolean)
  const beats = String(previous ?? '').split(/\n(?=\[Beat \d+\])/).map(item => item.trim()).filter(Boolean)
  beats.push(parts.join('\n'))
  while (beats.length > 48 || beats.join('\n').length > 12_000) beats.shift()
  return beats.join('\n')
}

function publicLoop(row) {
  if (!row) return null
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    branch_id: row.branch_id,
    command_id: row.command_id,
    status: row.status,
    phase: row.phase,
    step_count: row.step_count,
    input: json(row.input_json, {}),
    result: json(row.result_json, {}),
    error: json(row.error_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export class TurnRuntime {
  constructor({ db, repository, providers, contextBuilder, retrievalIndex = null, assets = null, logger }) {
    this.db = db
    this.repository = repository
    this.providers = providers
    this.contextBuilder = contextBuilder
    this.retrievalIndex = retrievalIndex
    this.assets = assets
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

  listRuns(conversationId) {
    this.repository.getConversation(conversationId)
    return this.db.raw.prepare('SELECT * FROM control_loop_runs WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 100')
      .all(conversationId).map(publicLoop)
  }

  getRun(runId) {
    const run = publicLoop(this.db.raw.prepare('SELECT * FROM control_loop_runs WHERE id = ?').get(runId))
    assert(run, 'Control loop not found', 404, 'not_found')
    return run
  }

  async resume(runId) {
    const run = this.getRun(runId)
    assert(run.status !== 'completed', 'Control loop has already completed', 409, 'loop_completed')
    return this.run(run.conversation_id, { content: run.input.content, attachmentIds: run.input.attachment_ids ?? [], resumeRunId: run.id })
  }

  async run(conversationId, { content, attachmentIds = [], idempotencyKey = null, resumeRunId = null } = {}) {
    if (this.running.has(conversationId)) {
      const error = new Error('A control loop is already running for this conversation')
      error.status = 409
      error.code = 'turn_in_progress'
      throw error
    }
    const controller = new AbortController()
    this.running.set(conversationId, controller)
    let conversation
    let branchId
    let loop
    let activeProviderResult = null
    let activeUsageRecorded = false
    let activePhase = 'initialization'
    const usage = {}
    try {
      conversation = this.repository.getConversation(conversationId)
      assert(typeof content === 'string', 'Message content is required')
      attachmentIds = [...new Set((Array.isArray(attachmentIds) ? attachmentIds : []).map(String).filter(Boolean))]
      content = content.trim() || (attachmentIds.length ? `I share ${attachmentIds.length} attachment${attachmentIds.length === 1 ? '' : 's'} with the Storyteller.` : '')
      assert(content, 'Message content is required')
      const mediaCapabilities = this.providers.mediaCapabilities(conversation.connection_id, conversation.model_id)
      const attachments = (this.assets?.resolve(conversationId, attachmentIds) ?? []).map(item => ({
        ...item,
        delivery: item.mime_type.startsWith('image/') && mediaCapabilities.images
          ? 'inline'
          : item.extracted_text ? 'text' : 'metadata_only',
      }))
      branchId = conversation.current_branch_id
      const story = conversation.story_id ? this.repository.getStory(conversation.story_id) : null
      const persona = this.repository.getPersona(conversation.persona_id)
      const cast = this.repository.listConversationCast(conversationId)
      const activeCast = cast.filter(member => !member.muted)
      assert(activeCast.length > 0 || cast.length === 0, 'Every character is quiet. Open Cast and invite at least one character back into the scene.', 409, 'all_cast_muted')
      const runtimeContent = applyStoryTransforms(story, 'user_input', content, { actorId: 'user', cast: activeCast })

      loop = this.#findOrCreateLoop({ conversation, branchId, content, attachments, idempotencyKey, resumeRunId, story, cast })
      if (loop.status === 'completed') return loop.result
      const turnUid = loop.result.turn_uid ?? id('turn')
      const commandId = loop.command_id
      const effectiveIntensity = loop.result.effective_thinking_intensity ?? resolveThinkingIntensity(conversation.thinking_intensity, {
        userMessage: runtimeContent,
        castSize: activeCast.length || 1,
        hasStory: Boolean(story),
        hasWorldState: Boolean(story && Object.keys(story.initial_state ?? {}).length),
      })
      const actionRegistry = new ActionRegistry({ story, cast: activeCast })
      const allowedParticipantIds = activeCast.map(member => member.character_id)
      let resultState = { ...loop.result, turn_uid: turnUid, effective_thinking_intensity: effectiveIntensity }

      if (loop.phase === 'interpretation') {
        activePhase = 'interpretation'
        const events = this.repository.events(conversationId, branchId)
        const projection = reduceEvents(events.filter(event => !(event.type === 'user.message' && event.command_id === commandId)), story?.initial_state ?? {})
        const controlContext = this.contextBuilder.buildControl({
          conversation, story, persona, cast: activeCast, projection, userMessage: runtimeContent,
          resolvedIntensity: effectiveIntensity, actionRegistry, attachments,
        })
        activeProviderResult = await this.#complete(conversation, controlContext.messages, effectiveIntensity, controller.signal, { phase: 'control', attachments })
        addUsage(usage, activeProviderResult)
        if (wasTruncated(activeProviderResult)) throw outputError('The AI service stopped during intent interpretation. The command is safely persisted and this loop can be resumed.', 'model_output_truncated')
        const parsed = safeJsonObject(activeProviderResult.content)
        if (!parsed) throw outputError('The AI service returned an invalid control plan. The command is safely persisted and this loop can be resumed.', 'invalid_model_output')
        const plan = normalizeControlPlan(parsed, {
          actionRegistry,
          activeAgendas: [],
          allowedParticipantIds,
          userMessage: runtimeContent,
          maxParticipants: participantLimit(conversation.generation?.pacing, allowedParticipantIds.length, runtimeContent),
        })
        const plannedActions = [...plan.actions]
        const pendingActions = plannedActions.slice(MAX_CONTROL_STEPS)
        const executableActions = plannedActions.slice(0, MAX_CONTROL_STEPS)
        const deterministic = this.db.transaction(() => {
          const appended = []
          appended.push(this.#event({
            conversationId, branchId, commandId, correlationId: loop.id, type: 'intent.interpreted',
            payload: {
              command_id: commandId,
              action_count: plannedActions.length,
              discarded_action_count: plan.discarded_actions.length,
              participants: plan.participants,
              internal_summary: plan.internal_summary,
              context_manifest: controlContext.manifest,
            },
          }))
          let currentProjection = reduceEvents(this.repository.events(conversationId, branchId), story?.initial_state ?? {})
          const receipts = []
          const observations = []
          for (const action of executableActions) {
            const proposed = this.#event({
              conversationId, branchId, commandId, correlationId: loop.id, type: 'action.proposed',
              actorId: action.actor_id, payload: action,
            })
            appended.push(proposed)
            const resolution = actionRegistry.resolve(action, currentProjection)
            const receiptEvent = this.#event({
              conversationId, branchId, commandId, correlationId: loop.id, causationId: proposed.event_uid,
              type: resolution.status === 'resolved' ? 'action.resolved' : 'action.rejected',
              actorId: action.actor_id, payload: resolution.receipt,
            })
            appended.push(receiptEvent)
            receipts.push(resolution.receipt)
            for (const observation of resolution.observations) {
              appended.push(this.#event({
                conversationId, branchId, commandId, correlationId: loop.id, causationId: receiptEvent.event_uid,
                type: 'observation.created', actorId: observation.actor_id, payload: observation,
              }))
              observations.push(observation)
            }
            currentProjection = reduceEvents(this.repository.events(conversationId, branchId), story?.initial_state ?? {})
          }
          resultState = {
            ...resultState,
            plan,
            participants: plan.participants,
            messages: [],
            receipts,
            observations,
            pending_actions: pendingActions,
            after_pending_phase: 'character_runtime',
            activated_lore_ids: controlContext.activatedLore.map(entry => String(entry.id ?? entry.key)),
            context_manifests: { control: controlContext.manifest, character: {}, narration: {} },
          }
          const nextStatus = pendingActions.length ? 'suspended' : 'running'
          const nextPhase = pendingActions.length ? 'actions_pending' : 'character_runtime'
          this.#updateLoop(loop.id, { status: nextStatus, phase: nextPhase, stepCount: executableActions.length, result: resultState, error: {} })
          if (pendingActions.length) appended.push(this.#event({
            conversationId, branchId, commandId, correlationId: loop.id, type: 'control.loop.suspended',
            payload: { loop_id: loop.id, phase: 'actions_pending', completed_steps: executableActions.length, pending_steps: pendingActions.length, reason: 'operational_step_guard' },
          }))
          return appended
        })
        this.#recordUsage({ conversation, turnUid, commandId, loopId: loop.id, branchId, providerResult: activeProviderResult, phase: 'interpretation', outcome: 'completed' })
        activeUsageRecorded = true
        if (pendingActions.length) {
          const suspended = this.getRun(loop.id)
          return this.#result({ conversation, loop: suspended, resultState, usage, events: deterministic, status: 'suspended' })
        }
        loop = this.getRun(loop.id)
      }

      if (loop.phase === 'actions_pending') {
        const resumed = this.#resolvePendingActions({ loop, conversation, story, cast: activeCast, actionRegistry })
        resultState = resumed.resultState
        loop = resumed.loop
        if (loop.phase === 'actions_pending') return this.#result({ conversation, loop, resultState, usage, events: resumed.events, status: 'suspended' })
      } else resultState = { ...resultState, ...loop.result }

      if (loop.phase === 'character_runtime') {
        activePhase = 'character_runtime'
        const participantIds = resultState.participants
          ?? (resultState.speakers ?? []).filter(item => item !== 'narrator' && item !== 'assistant')
          ?? []
        const memberById = new Map(activeCast.map(member => [member.character_id, member]))
        const existingPlans = new Map((resultState.character_plans ?? []).map(plan => [plan.character_id, plan]))
        const missingMembers = participantIds.map(participantId => memberById.get(participantId)).filter(member => member && !existingPlans.has(member.character_id))

        if (missingMembers.length) {
          const projection = reduceEvents(this.repository.events(conversationId, branchId), story?.initial_state ?? {})
          const turnReceiptIds = (resultState.receipts ?? []).map(receipt => receipt.action_id)
          const actorResults = await Promise.all(missingMembers.map(async member => {
            const characterContext = this.contextBuilder.buildCharacter({
              conversation, story, persona, cast: activeCast, projection, member,
              userMessage: runtimeContent, turnReceiptIds, attachments, actionRegistry,
            })
            let providerResult = null
            const providerAttempts = []
            const decodePlan = result => {
              if (wasTruncated(result)) throw outputError(`The AI service stopped while ${member.character.name} was deciding how to respond.`, 'model_output_truncated')
              const parsedPlan = safeJsonObject(result.content)
              if (!parsedPlan) throw outputError(`The AI service returned an invalid Character plan for ${member.character.name}.`, 'invalid_model_output')
              return normalizeCharacterPlan(parsedPlan, {
                actionRegistry,
                member,
                activeAgendas: characterContext.activeAgendas,
                allowedEventIds: characterContext.allowedEventIds,
                allowedRelationshipTargets: activeCast.map(candidate => candidate.character_id),
                previousState: characterContext.currentState,
              })
            }
            try {
              providerResult = await this.#complete(conversation, characterContext.messages, effectiveIntensity, controller.signal, { phase: 'character', attachments })
              const plan = decodePlan(providerResult)
              providerAttempts.push({ result: providerResult, outcome: 'completed', error: null })
              return { member, characterContext, providerAttempts, plan, error: null }
            } catch (error) {
              if (providerResult) providerAttempts.push({ result: providerResult, outcome: 'failed', error })
              const retryableContractFailure = providerResult
                && error.code !== 'model_output_truncated'
                && (error.status === 502 || /^invalid_|^character_identity_/.test(String(error.code ?? '')))
              if (!retryableContractFailure || controller.signal.aborted) {
                return { member, characterContext, providerAttempts, plan: null, error }
              }
              providerAttempts.at(-1).outcome = 'discarded_invalid_character_output'
              const correctionMessages = [
                ...characterContext.messages,
                {
                  role: 'system',
                  content: `CHARACTER PLAN CORRECTION REQUIRED\nThe discarded response was not a valid plan for ${member.character.name}: ${error.message}\nReturn exactly one complete, non-empty JSON object matching the required Character decision contract. Do not narrate prose outside JSON and do not decide for any other Character or the player.`,
                },
              ]
              let retryResult = null
              try {
                retryResult = await this.#complete(conversation, correctionMessages, effectiveIntensity, controller.signal, { phase: 'character', attachments, jsonMode: false })
                const plan = decodePlan(retryResult)
                providerAttempts.push({ result: retryResult, outcome: 'completed_after_character_retry', error: null })
                return { member, characterContext, providerAttempts, plan, error: null }
              } catch (retryError) {
                if (retryResult) providerAttempts.push({ result: retryResult, outcome: 'failed', error: retryError })
                const safeFallback = retryResult
                  && retryError.code !== 'model_output_truncated'
                  && (retryError.status === 502 || /^invalid_|^character_identity_/.test(String(retryError.code ?? '')))
                if (safeFallback) {
                  const plan = {
                    ...normalizeCharacterPlan({
                      character_id: member.character_id,
                      participation: 'observe',
                      perceived_event_ids: characterContext.allowedEventIds.slice(-8),
                      belief_updates: [],
                      emotional_state: characterContext.currentState.emotional_state,
                      relationship_shifts: [],
                      intent: 'Observe the verified outcome and withhold action until the next beat.',
                      agenda_decisions: characterContext.activeAgendas.map(agenda => ({
                        agenda_id: agenda.id,
                        decision: 'defer',
                        reason: 'No independent action is taken in this beat.',
                      })),
                      spontaneous_actions: [],
                      speech_act: null,
                      public_cue: '',
                    }, {
                      actionRegistry,
                      member,
                      activeAgendas: characterContext.activeAgendas,
                      allowedEventIds: characterContext.allowedEventIds,
                      allowedRelationshipTargets: activeCast.map(candidate => candidate.character_id),
                      previousState: characterContext.currentState,
                    }),
                    contract_fallback: true,
                  }
                  return { member, characterContext, providerAttempts, plan, error: null, contractFallback: true }
                }
                return { member, characterContext, providerAttempts, plan: null, error: retryError }
              }
            }
          }))

          const failures = []
          for (const actorResult of actorResults) {
            for (const attempt of actorResult.providerAttempts) {
              addUsage(usage, attempt.result)
              this.#recordUsage({
                conversation, turnUid, commandId, loopId: loop.id, branchId,
                providerResult: attempt.result,
                phase: `character:${actorResult.member.character_id}`,
                outcome: attempt.outcome,
                error: attempt.error,
              })
            }
            if (actorResult.plan) {
              existingPlans.set(actorResult.plan.character_id, actorResult.plan)
              resultState.context_manifests.character[actorResult.plan.character_id] = {
                ...actorResult.characterContext.manifest,
                contract_guard: {
                  retry_count: Math.max(0, actorResult.providerAttempts.length - 1),
                  fallback: Boolean(actorResult.contractFallback),
                },
              }
              resultState.activated_lore_ids = [...new Set([
                ...(resultState.activated_lore_ids ?? []),
                ...actorResult.characterContext.activatedLore.map(entry => String(entry.id ?? entry.key)),
              ])]
            } else failures.push(actorResult.error)
          }
          activeProviderResult = null
          activeUsageRecorded = true
          resultState.character_plans = [...existingPlans.values()]
          this.#updateLoop(loop.id, {
            status: failures.length ? 'suspended' : 'running',
            phase: 'character_runtime',
            stepCount: loop.step_count,
            result: resultState,
            error: failures.length ? { code: failures[0]?.code ?? 'character_runtime_failed', message: failures[0]?.message ?? 'A Character runtime failed.' } : {},
          })
          loop = this.getRun(loop.id)
          if (failures.length) throw failures[0]
        }

        const characterPlans = participantIds.map(participantId => existingPlans.get(participantId)).filter(Boolean)
        const characterActions = characterPlans.flatMap(plan => plan.actions ?? [])
        if (characterActions.length > MAX_CONTROL_STEPS) {
          throw outputError(`The Character runtimes proposed ${characterActions.length} Actions; the operational limit is ${MAX_CONTROL_STEPS}.`, 'character_plan_too_large')
        }
        this.db.transaction(() => {
          const appended = []
          let currentProjection = reduceEvents(this.repository.events(conversationId, branchId), story?.initial_state ?? {})
          for (const plan of characterPlans) {
            const member = memberById.get(plan.character_id)
            if (!currentProjection.characterStates?.[plan.character_id]) {
              appended.push(this.#event({
                conversationId, branchId, commandId, correlationId: loop.id,
                type: 'character.runtime.initialized', actorId: plan.character_id,
                payload: initialCharacterRuntimeState(member),
              }))
              currentProjection = reduceEvents(this.repository.events(conversationId, branchId), story?.initial_state ?? {})
            }
            appended.push(this.#event({
              conversationId, branchId, commandId, correlationId: loop.id,
              type: 'character.deliberated', actorId: plan.character_id,
              payload: {
                character_id: plan.character_id,
                turn_uid: turnUid,
                participation: plan.participation,
                perceived_event_ids: plan.perceived_event_ids,
                belief_updates: plan.belief_updates,
                emotional_state: plan.emotional_state,
                relationship_shifts: plan.relationship_shifts,
                intent: plan.intent,
                disclosures: plan.disclosures,
                public_cue: plan.public_cue,
              },
            }))
            for (const decision of plan.agenda_decisions) {
              appended.push(this.#event({
                conversationId, branchId, commandId, correlationId: loop.id, type: 'agenda.evaluated',
                actorId: plan.character_id,
                payload: {
                  agenda_id: decision.agenda_id,
                  decision: decision.decision,
                  model_decision: decision.decision,
                  reason: decision.reason,
                  action_id: decision.action?.id ?? null,
                },
              }))
            }
          }

          const receipts = [...(resultState.receipts ?? [])]
          const observations = [...(resultState.observations ?? [])]
          for (const action of characterActions) {
            const proposed = this.#event({
              conversationId, branchId, commandId, correlationId: loop.id, type: 'action.proposed',
              actorId: action.actor_id, payload: action,
            })
            appended.push(proposed)
            const resolution = actionRegistry.resolve(action, currentProjection)
            const receiptEvent = this.#event({
              conversationId, branchId, commandId, correlationId: loop.id, causationId: proposed.event_uid,
              type: resolution.status === 'resolved' ? 'action.resolved' : 'action.rejected',
              actorId: action.actor_id, payload: resolution.receipt,
            })
            appended.push(receiptEvent)
            receipts.push(resolution.receipt)
            for (const observation of resolution.observations) {
              appended.push(this.#event({
                conversationId, branchId, commandId, correlationId: loop.id, causationId: receiptEvent.event_uid,
                type: 'observation.created', actorId: observation.actor_id, payload: observation,
              }))
              observations.push(observation)
            }
            currentProjection = reduceEvents(this.repository.events(conversationId, branchId), story?.initial_state ?? {})
          }
          const lifecycle = this.#applyAgendaLifecycle({
            projection: currentProjection, conversationId, branchId, commandId, loopId: loop.id, story,
          })
          appended.push(...lifecycle.events)
          resultState = { ...resultState, character_plans: characterPlans, receipts, observations, character_runtime_committed: true }
          this.#updateLoop(loop.id, {
            status: 'running', phase: 'narration',
            stepCount: Number(loop.step_count) + characterPlans.length + characterActions.length,
            result: resultState, error: {},
          })
          return appended
        })
        loop = this.getRun(loop.id)
      }

      if (loop.phase === 'narration') {
        activePhase = 'narration'
        if (!(resultState.messages ?? []).length) {
          const participantIds = resultState.participants
            ?? (resultState.speakers ?? []).filter(item => item !== 'narrator' && item !== 'assistant')
            ?? []
          const transformActorId = participantIds.length === 1 ? participantIds[0] : 'narrator'
          activePhase = 'narration:storyteller'
          const projection = reduceEvents(this.repository.events(conversationId, branchId), story?.initial_state ?? {})
          const narrationContext = this.contextBuilder.buildNarration({
            conversation, story, persona, cast: activeCast, projection, participantIds,
            characterPlans: resultState.character_plans ?? [],
            userMessage: runtimeContent, turnReceiptIds: (resultState.receipts ?? []).map(receipt => receipt.action_id), attachments,
          })
          resultState.activated_lore_ids = [...new Set([
            ...(resultState.activated_lore_ids ?? []),
            ...narrationContext.activatedLore.map(entry => String(entry.id ?? entry.key)),
          ])]
          activeProviderResult = await this.#complete(conversation, narrationContext.messages, effectiveIntensity, controller.signal, { phase: 'narration', attachments })
          addUsage(usage, activeProviderResult)
          activeUsageRecorded = false
          if (wasTruncated(activeProviderResult)) throw outputError('The AI service stopped while rendering the Storyteller beat. Facts are safely committed and narration can be resumed.', 'model_output_truncated')
          let message = null
          let usageResultToRecord = activeProviderResult
          let usageOutcome = 'completed'
          let causalRetryCount = 0
          let causalFallback = false
          let discardedOutcome = 'discarded_causal_conflict'
          let conflict = null
          try {
            message = transformedSceneOutput({ story, raw: activeProviderResult.content,
              participantIds: narrationContext.participantIds,
              characterPlans: resultState.character_plans ?? [],
              cast: activeCast,
              narratorActorId: transformActorId,
            })
            message.participant_ids = narrationContext.participantIds
            conflict = narrationContradiction(message.content, projection, resultState.receipts ?? [])
              ?? narrationAutonomyConflict(message.content, runtimeContent)
              ?? narrationPrivateLeak(message.content, narrationContext.protectedPrivateFragments)
          } catch (error) {
            if (!['invalid_scene_output', 'invalid_model_output'].includes(error.code)) throw error
            discardedOutcome = 'discarded_invalid_scene_output'
            conflict = `The draft was not a valid Scene Block response: ${error.message}`
          }

          if (conflict) {
            this.#recordUsage({
              conversation, turnUid, commandId, loopId: loop.id, branchId,
              providerResult: activeProviderResult,
              phase: 'narration:storyteller:draft',
              outcome: discardedOutcome,
            })
            activeUsageRecorded = true
            usageResultToRecord = null
            causalRetryCount = 1
            this.logger.warn(discardedOutcome === 'discarded_invalid_scene_output' ? 'narration.scene_output_invalid' : 'narration.causal_conflict', {
              conversation_id: conversationId, loop_id: loop.id, command_id: commandId, participant_ids: narrationContext.participantIds,
            })

            const correctionMessages = [
              ...narrationContext.messages,
              {
                role: 'system',
                content: `STORYTELLER CORRECTION REQUIRED\nThe discarded draft violated a protected narration boundary: ${conflict}\nRegenerate the complete JSON Scene Block object from the verified Observations, Character Performance Briefs and current authoritative state. Do not mention this correction, invent any additional transition, expose unauthorized private text, or assign the player an unrequested action, speech, thought, feeling, memory, decision, or movement.`,
              },
            ]
            let corrected = null
            let correctionFailure = null
            try {
              activePhase = 'narration:storyteller:causal-retry'
              activeProviderResult = await this.#complete(conversation, correctionMessages, effectiveIntensity, controller.signal, { phase: 'narration', attachments })
              addUsage(usage, activeProviderResult)
              activeUsageRecorded = false
              usageResultToRecord = activeProviderResult
              if (wasTruncated(activeProviderResult)) {
                correctionFailure = 'The correction response was truncated.'
              } else {
                try {
                  corrected = transformedSceneOutput({ story, raw: activeProviderResult.content,
                    participantIds: narrationContext.participantIds,
                    characterPlans: resultState.character_plans ?? [],
                    cast: activeCast,
                    narratorActorId: transformActorId,
                  })
                  corrected.participant_ids = narrationContext.participantIds
                  correctionFailure = narrationContradiction(corrected.content, projection, resultState.receipts ?? [])
                    ?? narrationAutonomyConflict(corrected.content, runtimeContent)
                    ?? narrationPrivateLeak(corrected.content, narrationContext.protectedPrivateFragments)
                } catch (error) {
                  correctionFailure = error.message
                }
              }
            } catch (error) {
              if (controller.signal.aborted) throw error
              activeProviderResult = null
              activeUsageRecorded = true
              correctionFailure = error.message
            }

            if (corrected && !correctionFailure) {
              message = corrected
              usageOutcome = 'completed_after_causal_retry'
            } else {
              message = {
                character_id: 'narrator',
                content: canonicalNarration(narrationContext.observations),
                scene_blocks: [{ type: 'narration', content: canonicalNarration(narrationContext.observations) }],
                participant_ids: narrationContext.participantIds,
                causal_fallback: true,
              }
              causalFallback = true
              usageOutcome = 'causal_observation_fallback'
              this.logger.warn('narration.causal_fallback', {
                conversation_id: conversationId, loop_id: loop.id, command_id: commandId, participant_ids: narrationContext.participantIds,
                correction_failure: correctionFailure || 'causal_conflict',
              })
            }
          }

          message.causal_retry_count = causalRetryCount
          message.causal_fallback = causalFallback
          this.db.transaction(() => {
            this.#event({
              conversationId, branchId, commandId, correlationId: loop.id, type: 'message.rendered', actorId: 'narrator',
              idempotencyKey: `${loop.id}:message:storyteller`,
              payload: {
                content: message.content,
                metadata: {
                  turn_uid: turnUid,
                  command_id: commandId,
                  character_id: 'narrator',
                  participant_ids: narrationContext.participantIds,
                  activated_lore_ids: resultState.activated_lore_ids,
                  configured_thinking_intensity: conversation.thinking_intensity,
                  effective_thinking_intensity: effectiveIntensity,
                  causal_runtime: true,
                  causal_retry_count: causalRetryCount,
                  causal_fallback: causalFallback,
                  scene_blocks: message.scene_blocks,
                },
              },
            })
            resultState.messages = [...(resultState.messages ?? []), message]
            resultState.context_manifests.narration.storyteller = {
              ...narrationContext.manifest,
              causal_guard: { retry_count: causalRetryCount, fallback: causalFallback },
            }
            this.#updateLoop(loop.id, { status: 'running', phase: 'narration', stepCount: Number(loop.step_count) + 1, result: resultState, error: {} })
          })
          if (usageResultToRecord) {
            this.#recordUsage({
              conversation, turnUid, commandId, loopId: loop.id, branchId,
              providerResult: usageResultToRecord, phase: 'narration:storyteller', outcome: usageOutcome,
            })
            activeUsageRecorded = true
          }
          loop = this.getRun(loop.id)
        }
      }

      const completedEvents = this.db.transaction(() => {
        const appended = []
        const preSummaryProjection = reduceEvents(this.repository.events(conversationId, branchId), story?.initial_state ?? {})
        const turnActionIds = new Set((resultState.receipts ?? []).map(receipt => receipt.action_id))
        const visibleTurnObservations = visibleObservations(preSummaryProjection, 'user')
          .filter(item => turnActionIds.has(item.action_id))
        const continuitySummary = rollContinuitySummary(preSummaryProjection.summary, {
          turnNumber: preSummaryProjection.turnCount + 1,
          userMessage: content,
          narration: resultState.messages?.at(-1)?.content ?? '',
          observations: visibleTurnObservations,
        })
        appended.push(this.#event({
          conversationId, branchId, commandId, correlationId: loop.id, type: 'summary.updated',
          payload: { summary: continuitySummary, source: 'deterministic-rolling-v1' },
        }))
        appended.push(this.#event({
          conversationId, branchId, commandId, correlationId: loop.id, type: 'turn.completed',
          payload: {
            turn_uid: turnUid,
            command_id: commandId,
            loop_id: loop.id,
            configured_thinking_intensity: conversation.thinking_intensity,
            effective_thinking_intensity: effectiveIntensity,
            action_count: resultState.receipts?.length ?? 0,
            message_count: resultState.messages?.length ?? 0,
            internal_summary: resultState.plan?.internal_summary ?? '',
            causal_runtime: true,
          },
        }))
        appended.push(this.#event({
          conversationId, branchId, commandId, correlationId: loop.id, type: 'control.loop.completed',
          payload: { loop_id: loop.id, command_id: commandId, steps: Number(loop.step_count), state: 'quiescent' },
        }))
        const finalProjection = reduceEvents(this.repository.events(conversationId, branchId), story?.initial_state ?? {})
        const lastEvent = appended.at(-1)
        this.db.raw.prepare(`
          INSERT OR REPLACE INTO state_snapshots(conversation_id, branch_id, event_id, state_json, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(conversationId, branchId, lastEvent.id, stableStringify(finalProjection), new Date().toISOString())
        const finalResult = this.#result({ conversation, loop: { ...loop, status: 'completed', phase: 'completed' }, resultState, usage, events: [], status: 'completed' })
        this.#updateLoop(loop.id, { status: 'completed', phase: 'completed', stepCount: Number(loop.step_count), result: finalResult, error: {} })
        this.repository.touchConversation(conversationId, resultState.messages?.at(-1)?.content ?? content)
        return appended
      })
      const completedLoop = this.getRun(loop.id)
      const final = { ...completedLoop.result, events: completedEvents }
      try { this.retrievalIndex?.indexConversation(conversationId, branchId) } catch (error) {
        this.logger.warn('retrieval.index.failed', { conversation_id: conversationId, error: error.message })
      }
      this.logger.info('control.loop.completed', {
        conversation_id: conversationId, loop_id: loop.id, command_id: commandId,
        actions: resultState.receipts?.length ?? 0, messages: resultState.messages?.length ?? 0,
      })
      return final
    } catch (error) {
      if (conversation && branchId && loop) {
        try {
          this.db.transaction(() => {
            if (activeProviderResult && !activeUsageRecorded) {
              this.#recordUsage({
                conversation, turnUid: loop.result.turn_uid, commandId: loop.command_id, loopId: loop.id,
                branchId, providerResult: activeProviderResult, phase: activePhase, outcome: 'failed', error,
              })
            }
            this.#event({
              conversationId, branchId, commandId: loop.command_id, correlationId: loop.id,
              type: controller.signal.aborted ? 'control.loop.cancelled' : 'control.loop.suspended',
              payload: {
                loop_id: loop.id,
                command_id: loop.command_id,
                phase: activePhase,
                error: error.message,
                error_code: error.code || 'turn_failed',
                command_persisted: true,
              },
            })
            this.#event({
              conversationId, branchId, commandId: loop.command_id, correlationId: loop.id, type: 'turn.failed',
              payload: {
                turn_uid: loop.result.turn_uid,
                loop_id: loop.id,
                error: error.message,
                error_code: error.code || 'turn_failed',
                cancelled: controller.signal.aborted,
                user_message_committed: true,
                resumable: !controller.signal.aborted,
              },
            })
            this.#updateLoop(loop.id, {
              status: controller.signal.aborted ? 'cancelled' : 'suspended',
              phase: activePhase,
              stepCount: loop.step_count,
              result: loop.result,
              error: { code: error.code || 'turn_failed', message: error.message },
            })
          })
          this.repository.touchConversation(conversationId)
        } catch {}
      }
      this.logger.warn('control.loop.suspended', { conversation_id: conversationId, loop_id: loop?.id, phase: activePhase, error: error.message })
      throw error
    } finally {
      this.running.delete(conversationId)
    }
  }

  #findOrCreateLoop({ conversation, branchId, content, attachments = [], idempotencyKey, resumeRunId, story, cast }) {
    if (resumeRunId) {
      const loop = this.getRun(resumeRunId)
      assert(loop.conversation_id === conversation.id && loop.branch_id === branchId, 'Control loop does not belong to the active timeline', 409, 'loop_timeline_mismatch')
      assert(loop.input.content === content, 'Resume content does not match the persisted command', 409, 'loop_command_mismatch')
      assert(JSON.stringify(loop.input.attachment_ids ?? []) === JSON.stringify(attachments.map(item => item.id)), 'Resume attachments do not match the persisted command', 409, 'loop_command_mismatch')
      return loop
    }
    if (idempotencyKey) {
      const existingEvent = this.db.raw.prepare('SELECT * FROM events WHERE conversation_id = ? AND branch_id = ? AND idempotency_key = ?')
        .get(conversation.id, branchId, `${idempotencyKey}:command`)
      if (existingEvent) {
        const command = json(existingEvent.payload_json, {})
        const loop = publicLoop(this.db.raw.prepare('SELECT * FROM control_loop_runs WHERE command_id = ?').get(command.id))
        if (loop) {
          assert(loop.input.content === content, 'Idempotency key was already used for a different command', 409, 'idempotency_conflict')
          assert(JSON.stringify(loop.input.attachment_ids ?? []) === JSON.stringify(attachments.map(item => item.id)), 'Idempotency key was already used with different attachments', 409, 'idempotency_conflict')
          return loop
        }
      }
    }
    const loopId = id('loop')
    const commandId = id('command')
    const turnUid = id('turn')
    const timestamp = new Date().toISOString()
    const projection = reduceEvents(this.repository.events(conversation.id, branchId), story?.initial_state ?? {})
    assert(attachments.every(item => !item.message_event_uid), 'An attachment has already been sent', 409, 'attachment_already_used')
    const agendas = Object.keys(projection.agendas).length ? [] : normalizeStoryAgendas(story, cast)
    this.db.transaction(() => {
      for (const agenda of agendas) this.#event({ conversationId: conversation.id, branchId, type: 'agenda.created', actorId: agenda.owner_id, payload: agenda })
      this.db.raw.prepare(`
        INSERT INTO control_loop_runs(id, conversation_id, branch_id, command_id, status, phase, step_count, input_json, result_json, error_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'running', 'interpretation', 0, ?, ?, '{}', ?, ?)
      `).run(loopId, conversation.id, branchId, commandId, stableStringify({ content, attachment_ids: attachments.map(item => item.id), idempotency_key: idempotencyKey }), stableStringify({ turn_uid: turnUid }), timestamp, timestamp)
      this.#event({
        conversationId: conversation.id, branchId, commandId, correlationId: loopId, type: 'turn.started',
        idempotencyKey: idempotencyKey ? `${idempotencyKey}:turn` : null,
        payload: { turn_uid: turnUid, loop_id: loopId, command_id: commandId, configured_thinking_intensity: conversation.thinking_intensity, causal_runtime: true },
      })
      this.#event({
        conversationId: conversation.id, branchId, commandId, correlationId: loopId, type: 'command.received', actorId: 'user',
        idempotencyKey: idempotencyKey ? `${idempotencyKey}:command` : null,
        payload: { id: commandId, actor_id: 'user', content, expected_state_revision: projection.stateRevision },
      })
      const userEvent = this.#event({
        conversationId: conversation.id, branchId, commandId, correlationId: loopId, type: 'user.message', actorId: 'user',
        idempotencyKey: idempotencyKey ? `${idempotencyKey}:user` : null,
        payload: { content, metadata: { turn_uid: turnUid, loop_id: loopId, command_id: commandId, causal_runtime: true, attachments: attachments.map(({ data_base64: _data, extracted_text: _text, message_event_uid: _event, ...item }) => item) } },
      })
      this.assets?.attach(attachments.map(item => item.id), userEvent.event_uid)
    })
    return this.getRun(loopId)
  }

  #resolvePendingActions({ loop, conversation, story, cast, actionRegistry }) {
    const pending = loop.result.pending_actions ?? []
    const executable = pending.slice(0, MAX_CONTROL_STEPS)
    const remaining = pending.slice(MAX_CONTROL_STEPS)
    const events = this.db.transaction(() => {
      const appended = []
      let projection = reduceEvents(this.repository.events(conversation.id, loop.branch_id), story?.initial_state ?? {})
      const receipts = [...(loop.result.receipts ?? [])]
      const observations = [...(loop.result.observations ?? [])]
      for (const action of executable) {
        const proposed = this.#event({ conversationId: conversation.id, branchId: loop.branch_id, commandId: loop.command_id, correlationId: loop.id, type: 'action.proposed', actorId: action.actor_id, payload: action })
        appended.push(proposed)
        const resolution = actionRegistry.resolve(action, projection)
        const receiptEvent = this.#event({
          conversationId: conversation.id, branchId: loop.branch_id, commandId: loop.command_id, correlationId: loop.id,
          causationId: proposed.event_uid, type: resolution.status === 'resolved' ? 'action.resolved' : 'action.rejected', actorId: action.actor_id, payload: resolution.receipt,
        })
        appended.push(receiptEvent)
        receipts.push(resolution.receipt)
        for (const observation of resolution.observations) {
          appended.push(this.#event({ conversationId: conversation.id, branchId: loop.branch_id, commandId: loop.command_id, correlationId: loop.id, causationId: receiptEvent.event_uid, type: 'observation.created', actorId: observation.actor_id, payload: observation }))
          observations.push(observation)
        }
        projection = reduceEvents(this.repository.events(conversation.id, loop.branch_id), story?.initial_state ?? {})
      }
      const nextPhase = loop.result.after_pending_phase ?? 'narration'
      if (!remaining.length && nextPhase === 'narration') {
        const lifecycle = this.#applyAgendaLifecycle({
          projection, conversationId: conversation.id, branchId: loop.branch_id,
          commandId: loop.command_id, loopId: loop.id, story,
        })
        appended.push(...lifecycle.events)
        projection = lifecycle.projection
      }
      const resultState = { ...loop.result, receipts, observations, pending_actions: remaining }
      this.#updateLoop(loop.id, {
        status: remaining.length ? 'suspended' : 'running',
        phase: remaining.length ? 'actions_pending' : nextPhase,
        stepCount: Number(loop.step_count) + executable.length,
        result: resultState,
        error: {},
      })
      if (remaining.length) appended.push(this.#event({ conversationId: conversation.id, branchId: loop.branch_id, commandId: loop.command_id, correlationId: loop.id, type: 'control.loop.suspended', payload: { loop_id: loop.id, phase: 'actions_pending', completed_steps: executable.length, pending_steps: remaining.length, reason: 'operational_step_guard' } }))
      return appended
    })
    const next = this.getRun(loop.id)
    return { loop: next, resultState: next.result, events }
  }

  async #complete(conversation, messages, intensity, signal, { phase = 'control', attachments = [], jsonMode = null } = {}) {
    const providerResult = await this.providers.complete({
      model: conversation.model_id,
      messages,
      // Reasoning strength controls causal planning. Once receipts exist,
      // narration is a constrained rendering pass and should not spend or leak
      // another chain of thought.
      thinkingIntensity: phase === 'narration' ? 'none' : intensity,
      phase,
      maxOutputTokens: null,
      temperature: conversation.generation?.temperature ?? 0.8,
      topP: conversation.generation?.top_p ?? 1,
      generation: conversation.generation,
      jsonMode: jsonMode ?? ['control', 'character', 'narration'].includes(phase),
      route: conversation.route,
      attachments,
    }, {
      connectionId: conversation.connection_id,
      accountConnectionId: conversation.account_connection_id,
      signal,
    })
    return {
      ...providerResult,
      promptCharacters: messages.reduce((total, message) => total + String(message?.content ?? '').length, 0),
    }
  }

  #applyAgendaLifecycle({ projection, conversationId, branchId, commandId, loopId, story }) {
    const events = []
    let current = projection
    for (const agenda of Object.values(projection.agendas)) {
      const transition = agendaLifecycleTransition(agenda, current)
      if (!transition || transition.status === agenda.status) continue
      events.push(this.#event({
        conversationId, branchId, commandId, correlationId: loopId, type: 'agenda.updated', actorId: agenda.owner_id,
        payload: {
          id: agenda.id,
          status: transition.status,
          lifecycle_rule: transition.rule,
          reason: `Authored ${transition.rule} conditions matched authoritative state.`,
        },
      }))
      current = reduceEvents(this.repository.events(conversationId, branchId), story?.initial_state ?? {})
    }
    return { events, projection: current }
  }

  #recordUsage({ conversation, turnUid, commandId, loopId, branchId, providerResult, phase, outcome, error = null }) {
    this.db.transaction(() => {
      this.#event({
        conversationId: conversation.id, branchId, commandId, correlationId: loopId, type: 'model.usage',
        payload: usagePayload(providerResult, conversation, turnUid, phase, outcome, error),
      })
      insertUsage(this.db, { conversation, turnUid, providerResult, phase, outcome, error })
    })
  }

  #event({ conversationId, branchId, type, actorId = null, payload = {}, idempotencyKey = null, causationId = null, correlationId = null, commandId = null }) {
    return this.db.appendEvent({ conversationId, branchId, type, actorId, payload, idempotencyKey, causationId, correlationId, commandId })
  }

  #updateLoop(loopId, { status, phase, stepCount, result, error }) {
    this.db.raw.prepare(`
      UPDATE control_loop_runs SET status=?, phase=?, step_count=?, result_json=?, error_json=?, updated_at=? WHERE id=?
    `).run(status, phase, Number(stepCount ?? 0), stableStringify(result ?? {}), stableStringify(error ?? {}), new Date().toISOString(), loopId)
  }

  #result({ conversation, loop, resultState, usage, events, status }) {
    return {
      turn_uid: resultState.turn_uid,
      loop_id: loop.id,
      command_id: loop.command_id,
      status,
      phase: loop.phase,
      thinking_intensity: conversation.thinking_intensity,
      effective_thinking_intensity: resultState.effective_thinking_intensity,
      messages: resultState.messages ?? [],
      actions: resultState.plan?.actions ?? [],
      action_receipts: resultState.receipts ?? [],
      observations: resultState.observations ?? [],
      pending_actions: resultState.pending_actions ?? [],
      state_operations: [],
      usage,
      structured_output: true,
      context_manifests: resultState.context_manifests ?? {},
      events,
    }
  }
}
