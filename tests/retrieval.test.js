import assert from 'node:assert/strict'
import test from 'node:test'
import { SAMPLE_IDS } from '../src/domain/seed.js'
import { deserializeVector, serializeVector, vectorSimilarity, vectorize } from '../src/runtime/retrieval.js'
import { testApp } from './helpers.js'

test('the local retrieval index persists deterministic multilingual vectors and can be rebuilt from source', async t => {
  const { app } = await testApp(t)
  const source = '星门 archive key under the river stair'
  const roundTrip = deserializeVector(serializeVector(vectorize(source)))
  assert.ok(vectorSimilarity(roundTrip, '星门 archive key') > 0.35)

  const stats = app.retrievalIndex.stats()
  assert.ok(stats.documents > 0)
  assert.ok(stats.stories > 0)
  const results = app.retrievalIndex.search({ storyId: SAMPLE_IDS.story, query: 'celestial lens sealed archive', limit: 4 })
  assert.ok(results.some(item => item.source_type === 'story-lore' && /lens vanished/i.test(item.content)))

  const rebuilt = app.retrievalIndex.rebuildAll()
  assert.ok(rebuilt.indexed > 0)
  assert.equal(rebuilt.documents, app.retrievalIndex.stats().documents)
})
