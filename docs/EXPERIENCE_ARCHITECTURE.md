# Experience Architecture

Harness Tavern 0.12.0 is designed from the user’s intention outward, not from database entities or model infrastructure inward.

## Experience promise

A player should feel that they are returning to the same character or story. A creator should feel that they are describing and shaping an experience, not configuring an agent runtime.

The visible product language is:

```text
Character · Story · Persona · Playthrough · Timeline · Journal · Share
```

The following remain implementation concepts:

```text
Provider · routing · event projection · state operation · context budget · tool envelope
```

## Surfaces

### Player surface

Primary navigation:

- **Home** — continue, discover, and resume drafts;
- **Chats** — active relationships and story playthroughs;
- **Library** — characters, stories, and Personas;
- **Create** — plain-language character and story creation;
- **Settings** — profile, AI connections, sharing, extensions, appearance, and advanced options.

### Creator surface

Creator actions are entered from Create or an editable Character/Story detail page. Advanced private information is never mixed into the player Journal.

The creator can:

- generate an editable draft from a plain-language brief;
- shape cast roles and private knowledge;
- publish and immediately play-test;
- share a public preview or complete playable source;
- save a Story as a reusable declarative template.

### Public share surface

`/share.html` is deliberately independent from the authenticated/private application bootstrap. It receives only a sanitized snapshot and can never request creator-private content.

## First-use journey

1. Ask what the Tavern should call the user.
2. Ask whether they want to meet a character, enter a story, or create.
3. Route them directly to useful content.
4. Use the built-in model automatically.
5. Suggest external AI connections only after value has been demonstrated.

The onboarding setting is stored server-side, while the chosen language follows the user profile.

## Progressive disclosure

### Default player layer

- names, portraits, story hooks;
- natural-language scene and relationship descriptions;
- continue/start actions;
- nontechnical creation briefs;
- safe sharing.

### Optional advanced player layer

- response depth;
- response length;
- character initiative;
- model selection.

### Creator-only layer

- private character knowledge;
- Director-only lore;
- author notes;
- raw event and model diagnostics;
- full playable source export.

## Domain separation

### Story

A reusable creator work containing cast, world rules, scenes, lore, player role, and opening.

### Playthrough

One user’s entry into a Story with a selected Persona and player role.

### Timeline

A branch inside a Playthrough. A new timeline can inherit history up to an event boundary but cannot see future events from its parent.

### Conversation

The active message and event stream. Character-only chats use the same runtime without requiring a Story.

## Journal projection

The Player Journal is not a direct serialization of state. It is a purpose-built projection that:

- converts relationship dimensions to readable phrases;
- shows only player-visible lore and memories;
- removes keys associated with private, hidden, Director, or internal state;
- summarizes recent events;
- presents named timelines instead of branch identifiers.

The Creator Inspector uses a separate endpoint and authorization boundary.

## Friendly creation

The guided creator uses two phases:

```text
brief → editable draft → explicit publish
```

Draft generation is deterministic and offline by default. This guarantees that creation is available before a model connection exists. A future AI-assisted draft provider can implement the same service contract without changing the UI or persistence model.

## Usability invariants

Automated tests protect the following product rules:

- primary navigation contains no Models, Provider, State, or Agent Mode destination;
- onboarding does not require model configuration;
- default response depth is Automatic;
- raw JSON state is not a primary player action;
- public shares omit private and Director-only content;
- import always supports preview before mutation;
- every generated Story draft gives each cast member distinct private context;
- declarative extensions cannot contain executable fields;
- the bundled sample is a real three-character Playthrough, not a static mockup.
