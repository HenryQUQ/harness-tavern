# Experience architecture

Harness Tavern is designed from the user’s intention outward, not from database entities or model infrastructure inward.

## Experience promise

A player should feel that they are returning to the same Character or Story. An author should see a clear, editable, portable content model without being forced into the core team’s preferred creative process.

The visible product language is:

```text
Character · Story · Persona · Playthrough · Timeline · Journal · Share
```

The following remain implementation concepts:

```text
Provider · routing · event projection · Action resolution · context assembly · Control Plan
```

## Surfaces

### Player surface

Primary navigation:

- **Home** — continue and discover;
- **Chats** — active relationships and Story Playthroughs;
- **Library** — Characters, Stories, Personas, New, and Import;
- **Settings** — profile, AI connections, sharing, extensions, appearance, and advanced options.

There is no separate core **Create** product. Adding an item is a Library operation: choose a blank standard structure or import a standard file. This keeps content identity, editing, portability, and lifecycle in one place.

Inside a Story, prose remains the visual focus. A causal inspector beside it exposes player-safe Facts, visible Action receipts, public Intent, and Timeline/context diagnostics. It collapses to a drawer on small screens.

### Authoring surface

Authoring begins from an existing Library item or **Library → New**. Advanced private information is never mixed into the player Journal.

The author can:

- establish a blank Character identity or blank Story with an explicit Cast;
- edit the complete standard content model;
- use the same model for narrator-only, single-Character, and multi-Character Stories;
- play-test without copying authored content into chat as truth;
- share a player-safe preview or an editable/playable portable file;
- edit a canonical Story source directly with ordinary file and Git tools.

The core does not ask for a creative brief, recommend genre or relationships, generate a draft, or publish a generated result. Those are possible extension-level product choices, not universal framework responsibilities.

### Public share surface

`/share.html` is independent from the private application bootstrap. It receives only a sanitized snapshot and cannot request author-private content.

## First-use journey

1. Ask what the Tavern should call the user.
2. Offer a Character, a Story, or the Library.
3. Route directly to useful content.
4. Use the built-in model automatically.
5. Suggest external AI connections only after value has been demonstrated.

The onboarding setting is stored server-side, while the chosen language follows the user profile.

## Progressive disclosure

### Default player layer

- names, portraits, and Story hooks;
- natural-language Scene and relationship descriptions;
- continue/start actions;
- blank/import Library actions;
- safe sharing.

### Optional advanced player layer

- reasoning strength;
- response length;
- Character initiative;
- model selection and provider-compatible sampling controls.

### Author-only layer

- private Character knowledge;
- Director-only Lore;
- author notes;
- raw event and model diagnostics;
- complete editable source and export.

## Domain separation

### Character and Story

Character and Story are durable authored objects. A Story contains explicit Cast references, world rules, Scenes, Lore, player role, opening, and causal definitions. The Story source is authoritative for authored content.

### Playthrough

One user’s entry into a Story with a selected Persona and player role. Its facts and history do not rewrite the Story source.

### Timeline

A branch inside a Playthrough. A new Timeline can inherit history up to an event boundary but cannot see future events from its parent.

### Conversation

The player-facing narrative projection of an append-only event stream. Character-only chats use the same runtime without requiring a Story. Conversation text is never the authoritative world state.

### Control Loop

One durable command moves through interpretation, deterministic Action resolution, actor-scoped Observation, and narration. Provider failure suspends the loop at its current phase; resume does not duplicate already committed effects.

## Explicit Library lifecycle

The universal core flow is:

```text
blank standard structure or imported file
→ complete editable content
→ validated durable Library item
→ chat or Playthrough
```

Creating a blank Character asks only for a name. Creating a blank Story asks for a title and one or more existing Character references. Required structural fields can receive empty defaults, but no authored meaning is inferred. There is no generated draft or separate publish state.

An extension may visibly provide an opinionated assistant, transform, or blueprint. Its result must still cross the same explicit Character/Story validation boundary. Installing a blueprint does not change core creation behavior.

Older guided-creation drafts are preserved through a read-only compatibility boundary so upgrades do not destroy user data.

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

- primary navigation contains no Create, Models, Provider, State, or Agent Mode destination;
- onboarding does not require model configuration;
- Library content kinds declare `creation_mode: explicit` and `generated: false`;
- blank creation leaves creative fields empty and produces a standard editable object;
- old fixed-brief generation routes remain retired;
- default response depth is Automatic;
- raw JSON state is not a primary player action;
- public shares omit private and Director-only content;
- player APIs omit effect paths, private Agendas, and raw Control Plans;
- impossible Actions produce visible rejection receipts without changing facts;
- provider failures preserve Commands for idempotent resume;
- import always supports preview before mutation;
- declarative extensions cannot contain executable fields or silently drive core generation;
- the bundled sample is an editable Story v2 project with typed Actions and persistent Agendas, not a static mockup.
