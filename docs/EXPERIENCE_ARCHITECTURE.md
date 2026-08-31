# Experience architecture

Harness Tavern is designed from the user’s intention outward, not from database entities or model infrastructure inward.

## Experience promise

A player returns to the same Story, with the same Cast, world, private knowledge, unresolved intent, and causal history. An author works on one complete, editable, portable package instead of assembling a playable experience from unrelated top-level records.

The visible product language is:

```text
Story · Cast · Persona · Playthrough · Timeline · Journal · Share
```

The following remain implementation or compatibility concepts:

```text
Actor record · Character table · Provider · event projection · Action resolution · context assembly · Control Plan
```

## One playable aggregate

A **Story** is the unit users discover, create, import, edit, play, share, and version. It may contain:

- no Cast for narrator-only play;
- one Cast member for a traditional Character Card experience;
- any number of Cast members for an ensemble;
- Story Lore and actor-owned embedded Lore;
- Story and actor prompt layers, example dialogue, and alternate openings;
- safe text transforms and prompt automations;
- Scenes, initial state, typed Actions, Agendas, and visibility rules.

There is no separate Character destination in Home, Chats, Library, onboarding, favorites, sharing, or creation. Actors are edited inline in **Story workspace → Cast**. Internal Actor records exist so stable source mappings, causal ownership, and SillyTavern compatibility remain reliable; they are not an independent product lifecycle.

## Surfaces

### Player surface

Primary navigation:

- **Home** — continue Playthroughs and discover Stories;
- **Chats** — Story Playthroughs grouped by Story identity;
- **Library** — Stories, Personas, New Story, and Import;
- **Settings** — profile, AI connections, sharing, extensions, appearance, and advanced options.

Inside a Story, prose remains the visual focus. A causal inspector exposes player-safe Facts, visible Action receipts, public Intent, and Timeline/context diagnostics. It collapses to a drawer on small screens.

Chats use one continuous workspace. A compact rail groups every Conversation by Story, and the same rail remains available while a desktop Conversation is open. On small screens the rail becomes the complete Chats view and yields the screen to the active Conversation.

### Authoring surface

Authoring begins from a Story in the Library, **New Story**, or **Import as Story**. The Story workspace contains:

- **Story** — identity, premise, player role, opening, visibility, and presentation;
- **Cast** — complete inline Actor fields, role, public/private context, prompt layers, examples, alternate greetings, goals, secrets, boundaries, isolated-mind initiative/drives/fears/values/mannerisms/reveal policy, metadata, and extensions;
- **World & lore** — rules and audience-scoped, keyword-activated Lore;
- **Scenes** — ordered Markdown Scenes and active Cast;
- **Causality** — initial state, world schema, typed Actions, Agendas, state visibility, and prompt graph;
- **Runtime** — safe scoped transforms and prompt automations;
- **Advanced** — author notes, share policy, metadata, and canonical source access.

The core does not ask for a creative brief, recommend genre or relationships, generate a draft, or publish a generated result. Those are possible extension-level product choices, not universal framework responsibilities.

### Public share surface

`/share.html` is independent from the private application bootstrap. It receives only a sanitized Story or Playthrough snapshot and cannot request author-private content.

## First-use journey

1. Ask what the Tavern should call the user.
2. Offer a Story or the Story Library.
3. Route directly to useful content.
4. Let the user inspect, author, or import content without a provider.
5. Require an explicit AI connection before starting a Playthrough; never silently substitute a bundled model.

The onboarding setting is stored server-side, while the chosen language follows the user profile.

## Progressive disclosure

### Default player layer

- Story hooks, Cast portraits, and natural-language Scene descriptions;
- continue/start actions and alternate opening selection;
- New Story and Import as Story;
- safe sharing.

### Optional advanced player layer

- reasoning strength and response length;
- Cast initiative and group pacing;
- model selection and provider-compatible sampling controls.

The per-Conversation AI panel follows progressive disclosure. Common response controls stay together; connection/model choice, model input assembly, sampling, and provider-specific overrides remain in labeled disclosure rows. Saving applies the complete form to the next reply without changing the causal runtime type.

### Author-only layer

- private Cast context and secrets;
- Director-only Lore;
- author notes and raw compatibility extensions;
- causal definitions, diagnostics, and complete editable source.

## Domain separation

### Story and Cast

A Story is the durable authored aggregate. Cast membership records which Actors participate and stores Story-specific role and public/private context. Actor content belongs to the Story source even though the compiled SQLite projection uses internal Actor rows.

At runtime, the Director sees public Cast summaries and chooses relevant candidates. Each selected Actor then runs in an isolated Character context and persists its own perceptions, beliefs, emotional state, relationship stance, intent, and disclosure history. Only its filtered Performance Brief reaches the Storyteller. The player still receives one scene, rendered as identity-preserving narration, action, and dialogue blocks; Character depth does not become a reply queue.

### Persona

The player’s reusable identity. Selecting a Persona for a Playthrough does not modify the Story source.

### Playthrough

One user’s entry into a Story with a selected Persona, player role, opening route, and causal history. Its facts never rewrite the Story source.

### Timeline

A branch inside a Playthrough. A new Timeline inherits history up to an event boundary but cannot see future events from its parent.

### Conversation

The player-facing narrative projection of an append-only event stream. Every new Conversation belongs to a Story Playthrough. Conversation text is never the authoritative world state.

### Story Runtime and Control Loop

The Story Runtime activates Lore, expands supported macros, applies safe scoped text transforms, and injects declarative automations around the causal pipeline. One durable command then moves through interpretation, deterministic Action resolution, actor-scoped Observation, and narration. Provider failure suspends the loop at its current phase; resume does not duplicate already committed effects.

## Explicit Library lifecycle

The universal core flow is:

```text
blank Story or imported content
→ complete editable Story with owned Cast and Runtime
→ validated durable Library item
→ Playthrough
```

Creating a blank Story asks only for a title. An optional first Cast member can be entered inline, or the Story can remain narrator-only. Required structural fields receive empty defaults, but no authored meaning is inferred. A direct SillyTavern Character Card is imported as a single-cast Story, not as a separate Library type.

An extension may visibly provide an opinionated assistant, transform, or blueprint. Its result must still cross the same explicit Story validation boundary. Installing a blueprint does not change core creation behavior. Older guided-creation drafts are preserved through a read-only compatibility boundary so upgrades do not destroy user data.

## Journal projection

The Player Journal is not a direct serialization of state. It:

- converts relationship dimensions to readable phrases;
- shows only player-visible Lore and memories;
- removes private, hidden, Director, and internal state;
- summarizes recent events;
- shows visible Action results without exposing internal effect paths;
- presents named Timelines instead of branch identifiers.

The author inspector uses a separate endpoint and authorization boundary.

## Usability invariants

Automated tests protect these rules:

- primary navigation has no Character, Create, Models, Provider, State, or Agent Mode destination;
- bootstrap and Home omit top-level Character collections;
- Library advertises only Story as playable content and Persona as player identity;
- every Conversation has a Story grouping identity and a Playthrough;
- the Story workspace edits complete Cast and Runtime in place;
- direct Character Cards normalize to single-cast Stories;
- blank creation can produce a narrator-only Story and never invents creative fields;
- default response depth is Automatic;
- raw JSON state is not a primary player action;
- public shares omit private and Director-only content;
- player APIs omit effect paths, private Agendas, and raw Control Plans;
- impossible Actions produce visible rejection receipts without changing facts;
- provider failures preserve Commands for idempotent resume;
- import always supports preview before mutation;
- declarative Runtime and extensions cannot execute imported code;
- the bundled sample is an editable Story v2 project with typed Actions and persistent Agendas, not a static mockup.
