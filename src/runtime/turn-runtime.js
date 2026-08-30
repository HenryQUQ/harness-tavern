import { assert, id, json, stableStringify } from '../util.js'
import { reduceEvents } from '../domain/projection.js'
import { ActionRegistry, agendaLifecycleTransition, normalizeStoryAgendas } from './action-registry.js'
import { narrationContradiction, normalizeControlPlan, normalizeNarration, safeJsonObject } from './contracts.js'
import { resolveThinkingIntensity } from './thinking.js'

const TRUNCATED_FINISH_REASONS = new Set([
  'length', 'max_tokens', 'max_token', 'max_output_tokens', 'model_context_window_exceeded',
])
const MAX_CONTROL_STEPS = 32

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
    stableStringify({ ...usage, phase, outcome, finishReason: providerResult.finishReason ?? null, errorCode: error?.code ?? null }),
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
    return this.run(run.conversation_id, { content: run.input.content, resumeRunId: run.id })
  }

  async run(conversationId, { content, idempotencyKey = null, resumeRunId = null } = {}) {
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
      assert(typeof content === 'string' && content.trim().length > 0, 'Message content is required')
      content = content.trim()
      conversation = this.repository.getConversation(conversationId)
      branchId = conversation.current_branch_id
      const story = conversation.story_id ? this.repository.getStory(conversation.story_id) : null
      const persona = this.repository.getPersona(conversation.persona_id)
      const cast = this.repository.listConversationCast(conversationId)
      const activeCast = cast.filter(member => !member.muted)
      assert(activeCast.length > 0 || cast.length === 0, 'Every character is quiet. Open Cast and invite at least one character back into the scene.', 409, 'all_cast_muted')

      loop = this.#findOrCreateLoop({ conversation, branchId, content, idempotencyKey, resumeRunId, story, cast })
      if (loop.status === 'completed') return loop.result
      const turnUid = loop.result.turn_uid ?? id('turn')
      const commandId = loop.command_id
      const effectiveIntensity = loop.result.effective_thinking_intensity ?? resolveThinkingIntensity(conversation.thinking_intensity, {
        userMessage: content,
        castSize: activeCast.length || 1,
        hasStory: Boolean(story),
        hasWorldState: Boolean(story && Object.keys(story.initial_state ?? {}).length),
      })
      const actionRegistry = new ActionRegistry({ story, cast: activeCast })
      const allowedSpeakerIds = activeCast.length ? [...activeCast.map(member => member.character_id), 'narrator'] : ['assistant']
      let resultState = { ...loop.result, turn_uid: turnUid, effective_thinking_intensity: effectiveIntensity }

      if (loop.phase === 'interpretation') {
        activePhase = 'interpretation'
        const events = this.repository.events(conversationId, branchId)
        const projection = reduceEvents(events.filter(event => !(event.type === 'user.message' && event.command_id === commandId)), story?.initial_state ?? {})
        const controlContext = this.contextBuilder.buildControl({
          conversation, story, persona, cast: activeCast, projection, userMessage: content,
          resolvedIntensity: effectiveIntensity, actionRegistry,
        })
        activeProviderResult = await this.#complete(conversation, controlContext.messages, effectiveIntensity, controller.signal, { phase: 'control' })
        addUsage(usage, activeProviderResult)
        if (wasTruncated(activeProviderResult)) throw outputError('The AI service stopped during intent interpretation. The command is safely persisted and this loop can be resumed.', 'model_output_truncated')
        const parsed = safeJsonObject(activeProviderResult.content)
        if (!parsed) throw outputError('The AI service returned an invalid control plan. The command is safely persisted and this loop can be resumed.', 'invalid_model_output')
        const plan = normalizeControlPlan(parsed, {
          actionRegistry,
          activeAgendas: controlContext.activeAgendas,
          allowedSpeakerIds,
          userMessage: content,
          maxSpeakers: conversation.generation?.pacing === 'focused' && !/\b(all|everyone|each|together)\b|所有|每个人|一起/iu.test(content) ? 1 : allowedSpeakerIds.length,
        })
        const plannedActions = [
          ...plan.actions,
          ...plan.agenda_decisions.filter(decision => decision.decision === 'act' && decision.action).map(decision => decision.action),
        ]
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
              speakers: plan.speakers,
              internal_summary: plan.internal_summary,
              context_manifest: controlContext.manifest,
            },
          }))
          for (const decision of plan.agenda_decisions) {
            appended.push(this.#event({
              conversationId, branchId, commandId, correlationId: loop.id, type: 'agenda.evaluated',
              actorId: projection.agendas[decision.agenda_id]?.owner_id ?? null,
              payload: {
                agenda_id: decision.agenda_id,
                decision: decision.decision,
                model_decision: decision.requested_decision,
                reason: decision.reason,
                action_id: decision.action?.id ?? null,
              },
            }))
          }
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
          if (!pendingActions.length) {
            const lifecycle = this.#applyAgendaLifecycle({
              projection: currentProjection, conversationId, branchId, commandId, loopId: loop.id, story,
            })
            appended.push(...lifecycle.events)
            currentProjection = lifecycle.projection
          }
          resultState = {
            ...resultState,
            plan,
            speakers: plan.speakers,
            messages: [],
            receipts,
            observations,
            pending_actions: pendingActions,
            context_manifests: { control: controlContext.manifest, narration: {} },
          }
          const nextStatus = pendingActions.length ? 'suspended' : 'running'
          const nextPhase = pendingActions.length ? 'actions_pending' : 'narration'
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

      if (loop.phase === 'narration') {
        activePhase = 'narration'
        const existingSpeakerIds = new Set((resultState.messages ?? []).map(message => message.character_id))
        for (const speakerId of resultState.speakers ?? []) {
          if (existingSpeakerIds.has(speakerId)) continue
          activePhase = `narration:${speakerId}`
          const projection = reduceEvents(this.repository.events(conversationId, branchId), story?.initial_state ?? {})
          const narrationContext = this.contextBuilder.buildNarration({
            conversation, story, persona, cast: activeCast, projection, actorId: speakerId,
            userMessage: content, turnReceiptIds: (resultState.receipts ?? []).map(receipt => receipt.action_id),
          })
          activeProviderResult = await this.#complete(conversation, narrationContext.messages, effectiveIntensity, controller.signal, { phase: 'narration' })
          addUsage(usage, activeProviderResult)
          activeUsageRecorded = false
          if (wasTruncated(activeProviderResult)) throw outputError(`The AI service stopped while rendering ${narrationContext.actorName}. Facts are safely committed and narration can be resumed.`, 'model_output_truncated')
          let message = normalizeNarration(activeProviderResult.content, speakerId)
          let usageResultToRecord = activeProviderResult
          let usageOutcome = 'completed'
          let causalRetryCount = 0
          let causalFallback = false
          let conflict = narrationContradiction(message.content, projection, resultState.receipts ?? [])

          if (conflict) {
            this.#recordUsage({
              conversation, turnUid, commandId, loopId: loop.id, branchId,
              providerResult: activeProviderResult,
              phase: `narration:${speakerId}:draft`,
              outcome: 'discarded_causal_conflict',
            })
            activeUsageRecorded = true
            usageResultToRecord = null
            causalRetryCount = 1
            this.logger.warn('narration.causal_conflict', {
              conversation_id: conversationId, loop_id: loop.id, command_id: commandId, speaker_id: speakerId,
            })

            const correctionMessages = [
              ...narrationContext.messages,
              {
                role: 'system',
                content: `CAUSAL CORRECTION REQUIRED\nThe discarded draft contradicted committed state: ${conflict}\nRegenerate the complete user-visible prose from the verified Observations and current authoritative state. Do not mention this correction or invent any additional transition.`,
              },
            ]
            let corrected = null
            let correctionFailure = null
            try {
              activePhase = `narration:${speakerId}:causal-retry`
              activeProviderResult = await this.#complete(conversation, correctionMessages, effectiveIntensity, controller.signal, { phase: 'narration' })
              addUsage(usage, activeProviderResult)
              activeUsageRecorded = false
              usageResultToRecord = activeProviderResult
              if (wasTruncated(activeProviderResult)) {
                correctionFailure = 'The correction response was truncated.'
              } else {
                try {
                  corrected = normalizeNarration(activeProviderResult.content, speakerId)
                  correctionFailure = narrationContradiction(corrected.content, projection, resultState.receipts ?? [])
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
                character_id: speakerId,
                content: canonicalNarration(narrationContext.observations),
                causal_fallback: true,
              }
              causalFallback = true
              usageOutcome = 'causal_observation_fallback'
              this.logger.warn('narration.causal_fallback', {
                conversation_id: conversationId, loop_id: loop.id, command_id: commandId, speaker_id: speakerId,
                correction_failure: correctionFailure || 'causal_conflict',
              })
            }
          }

          message.causal_retry_count = causalRetryCount
          message.causal_fallback = causalFallback
          this.db.transaction(() => {
            this.#event({
              conversationId, branchId, commandId, correlationId: loop.id, type: 'message.rendered', actorId: speakerId,
              idempotencyKey: `${loop.id}:message:${speakerId}`,
              payload: {
                content: message.content,
                metadata: {
                  turn_uid: turnUid,
                  command_id: commandId,
                  character_id: speakerId,
                  configured_thinking_intensity: conversation.thinking_intensity,
                  effective_thinking_intensity: effectiveIntensity,
                  causal_runtime: true,
                  causal_retry_count: causalRetryCount,
                  causal_fallback: causalFallback,
                },
              },
            })
            resultState.messages = [...(resultState.messages ?? []), message]
            resultState.context_manifests.narration[speakerId] = {
              ...narrationContext.manifest,
              causal_guard: { retry_count: causalRetryCount, fallback: causalFallback },
            }
            this.#updateLoop(loop.id, { status: 'running', phase: 'narration', stepCount: Number(loop.step_count) + 1, result: resultState, error: {} })
          })
          if (usageResultToRecord) {
            this.#recordUsage({
              conversation, turnUid, commandId, loopId: loop.id, branchId,
              providerResult: usageResultToRecord, phase: `narration:${speakerId}`, outcome: usageOutcome,
            })
            activeUsageRecorded = true
          }
          loop = this.getRun(loop.id)
        }
      }

      const completedEvents = this.db.transaction(() => {
        const appended = []
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

  #findOrCreateLoop({ conversation, branchId, content, idempotencyKey, resumeRunId, story, cast }) {
    if (resumeRunId) {
      const loop = this.getRun(resumeRunId)
      assert(loop.conversation_id === conversation.id && loop.branch_id === branchId, 'Control loop does not belong to the active timeline', 409, 'loop_timeline_mismatch')
      assert(loop.input.content === content, 'Resume content does not match the persisted command', 409, 'loop_command_mismatch')
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
          return loop
        }
      }
    }
    const loopId = id('loop')
    const commandId = id('command')
    const turnUid = id('turn')
    const timestamp = new Date().toISOString()
    const projection = reduceEvents(this.repository.events(conversation.id, branchId), story?.initial_state ?? {})
    const agendas = Object.keys(projection.agendas).length ? [] : normalizeStoryAgendas(story, cast)
    this.db.transaction(() => {
      for (const agenda of agendas) this.#event({ conversationId: conversation.id, branchId, type: 'agenda.created', actorId: agenda.owner_id, payload: agenda })
      this.db.raw.prepare(`
        INSERT INTO control_loop_runs(id, conversation_id, branch_id, command_id, status, phase, step_count, input_json, result_json, error_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'running', 'interpretation', 0, ?, ?, '{}', ?, ?)
      `).run(loopId, conversation.id, branchId, commandId, stableStringify({ content, idempotency_key: idempotencyKey }), stableStringify({ turn_uid: turnUid }), timestamp, timestamp)
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
      this.#event({
        conversationId: conversation.id, branchId, commandId, correlationId: loopId, type: 'user.message', actorId: 'user',
        idempotencyKey: idempotencyKey ? `${idempotencyKey}:user` : null,
        payload: { content, metadata: { turn_uid: turnUid, loop_id: loopId, command_id: commandId, causal_runtime: true } },
      })
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
      if (!remaining.length) {
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
        phase: remaining.length ? 'actions_pending' : 'narration',
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

  async #complete(conversation, messages, intensity, signal, { phase = 'control' } = {}) {
    return this.providers.complete({
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
      jsonMode: phase === 'control',
      route: conversation.route,
    }, {
      connectionId: conversation.connection_id,
      accountConnectionId: conversation.account_connection_id,
      signal,
    })
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
