# Creator Guide

## Create a character

1. Open **Create**.
2. Choose **Character** or a friendly Character Template.
3. Describe who the character is and what kind of relationship you want.
4. Generate the draft.
5. Review the first message, voice, goals, private facts, and boundaries.
6. Publish, then start a chat or add the character to a Story.

A useful brief sounds like:

> A reserved museum conservator named Noor who notices tiny details, has dry humour, and slowly learns to trust the user. She should disagree when preservation ethics matter.

You do not need to describe prompts, memory systems, or state schemas.

After publishing, open the Character in **Library → Edit character**. The Character workspace keeps identity, appearance, voice, meeting scenario, first message, long-term goals, private facts, boundaries, creator notes, Character Card metadata, and extension data editable. If the Character is referenced by a canonical Story source, saving updates that file as well. A newer external file edit is never silently overwritten.

## Create a story

1. Open **Create**.
2. Choose a Story Template or start from a blank brief.
3. Describe the experience, not the implementation.
4. Choose cast size, genre, tone, and player role.
5. Generate an editable draft.
6. Review each cast member’s role and private context.
7. Publish and Playtest.

Publishing creates a versioned editable Story source. Open the Story in **Library → Edit story** to use the visual workspace:

- **Overview** edits the player-facing invitation, role, tone, visibility, tags, cover, and content notes.
- **Cast** adds, removes, and reorders any number of Characters and edits their public/private Story context.
- **World & lore** edits the opening, rules, and audience-scoped Lore entries.
- **Scenes** adds, removes, reorders, and edits Markdown scenes and their active Cast.
- **Causality** edits Initial State, World Schema, typed Actions, durable Agendas, State Visibility, and the Prompt Graph.
- **Advanced** edits author notes, metadata, share policy, and opens the complete source editor.

Every save validates and writes the canonical source before rebuilding the runtime projection. If another tab or text editor changed the source since it was opened, the save is rejected and asks you to reload. Choose **Open complete Story source** for direct JSON control, or download the source for a text editor. For a larger project, export with `npm run story:export -- <story-key> <directory> --project` and keep Characters, Lorebooks, Markdown scenes, Actions and Agendas in separate files. Narrator-only, single-character and multi-character Stories use the same v2 format and editor.

A useful brief sounds like:

> Three former friends are trapped overnight in an abandoned broadcast station. One of them caused the emergency, another knows why the station was closed, and the third is trying to keep everyone together. The user arrives as a freelance engineer.

## What makes a strong multi-character Story

Each character should have:

- a reason to remain in the scene;
- a goal that is not identical to everyone else’s;
- something they know publicly;
- something only they know;
- a plausible reason not to reveal everything immediately;
- a distinct speaking rhythm;
- a boundary preventing them from controlling the user.

## Public and private information

Use **public context** for what the cast can reasonably know at the beginning. Use **private context** for facts that guide one character’s behaviour but must not automatically become group knowledge.

Director-only Lore can move the story, but it should reach the player through evidence, events, or a character who has earned the right to reveal it.

## World rules

Hard rules should describe facts the narration cannot casually ignore, for example:

- a sealed door needs a key, authority, force, or another credible method;
- only a named character knows the code;
- midnight occurs after the world clock reaches zero;
- the player’s thoughts and actions are never selected by the system.

Rules written only as prose can guide narration but cannot enforce causality. Put facts in `initial_state`, define allowed transitions as typed `actions`, and give long-running character goals durable `agendas`. Add `complete_when`, `fail_when`, `pause_when`, or `resume_when` only when a projected fact should change an Agenda's lifecycle; without those conditions the model cannot end persistent Intent by assertion. Use `state_visibility` when a fact must be available to the Director or one Character but hidden from other narrators and the player.

## Playtest checklist

- Ask each character the same question separately. Do their answers differ?
- Ask one character about another’s secret. Do they avoid unexplained omniscience?
- Attempt an impossible action. Does the world resist rather than silently comply?
- Stay silent and let the cast continue. Do they pursue their own goals?
- Create a What-if Timeline. Does later information remain isolated between branches?
- Open the Player Journal. Does it avoid creator-only information?

## Share the story

Use **Public preview** when the goal is discovery. Use **Download editable Story source** when another creator should read, version or modify the Story. Use **Download portable Tavern pack** for integrity-checked instance compatibility, or export a playthrough when the causal history should continue elsewhere. State the license and whether remixing is allowed.
