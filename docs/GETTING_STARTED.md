# Getting started

This guide takes you from a fresh checkout to your first Story Playthrough. You do not need an AI API key to complete it.

## Before you begin

Install:

- [Node.js](https://nodejs.org/) 22.19 or newer;
- Git;
- a current desktop browser.

Harness Tavern runs locally and stores its data on your computer. The default data directory is `~/.harness-tavern`.

## Install and start

From a terminal:

```bash
git clone https://github.com/HenryQUQ/harness-tavern.git
cd harness-tavern
npm ci
npm start
```

Open **http://127.0.0.1:8787** in your browser. Keep the terminal open while you use the application. Press `Ctrl+C` in that terminal to stop it.

The first startup creates a default Persona and the three-member ensemble Story **Midnight at the Glass Observatory**. It creates neither a model connection nor a fake Conversation, so provider choice is explicit and Chats remains an honest record of Playthroughs you started.

## Complete onboarding

The initial setup asks only:

1. what the Tavern should call you;
2. whether you want to enter a Story or open the Story Library.

Choose either route. You can author, inspect, and import Stories without a provider. Before starting a Playthrough, connect an AI service under **Settings → AI Connections**.

## Enter a Story

1. Open **Library** and select a Story.
2. Review its hook, cast, player role, and content notes.
3. If no AI service is connected, follow the prompt to **Settings → AI Connections**.
4. Choose **Enter Story**. A single-cast Story may also offer alternate Character Card greetings.
5. Select a Persona and begin the Playthrough.

Open the Story Engine panel during play to see the information that is safe for the player:

- known facts;
- visible Action outcomes;
- public ongoing character Intent;
- the current State revision;
- timelines and context diagnostics.

Creator-only Lore, private Cast knowledge, raw control plans, and hidden state are not shown there.

Each input advances the Story once. The Director first interprets only the player's contribution. Every relevant Character then decides independently from its own private knowledge and actor-visible facts; each can act, speak, react, observe, or intentionally remain silent. Finally, one Storyteller composes typed narration, action, and dialogue Scene Blocks into a coherent beat rather than producing one reply from every Cast member. The slim Cast line above the stage shows each Character's public presence and latest participation without exposing private thoughts.

The composer can attach up to four supported files (6 MB combined, 4 MB each). Text, Markdown, and JSON can be read as bounded text. Images reach only a provider/model known to support visual input; otherwise the Storyteller sees metadata and is instructed not to invent what the image contains. Sent attachments become immutable conversation history. The microphone button uses browser voice dictation when available, and **Read aloud** uses browser speech synthesis; neither changes causal State.

## Create a branch

A Story playthrough can contain multiple timelines. Create a new timeline when you want to explore a different decision without replacing the original history. The new branch inherits events only up to its branch point and cannot read future events from its parent.

## Connect your preferred AI

Harness Tavern has no built-in generation model. A Playthrough requires an explicitly connected provider, while content authoring and library operations remain local and provider-independent.

1. Open **Settings → AI Connections**.
2. Choose a provider or an OpenAI-compatible connection.
3. Enter the endpoint, API key, and default model requested by that provider.
4. Save the connection and use **Refresh models** when the provider supports discovery.
5. Open a chat and use the model menu in its header to select the connection and model.

Supported connection families include OpenRouter, OpenAI-compatible APIs, Anthropic, Gemini, Azure OpenAI, Ollama, LM Studio, vLLM, llama.cpp, and LocalAI. Consumer website subscriptions are not API credentials unless the service exposes an official authorization flow.

Provider keys are encrypted at rest. They are not included in public shares, Story files, Tavern packs, or portable backups. Do not paste a key into an issue, screenshot, Story, or chat message.

## Choose or create a response preset

The chat model menu puts the current preset, thinking strength, response length, character initiative, and group pacing at the top. Connection, model input, and advanced sampling stay collapsed until you need them. Built-in presets include approachable options such as **Balanced**, **Cinematic**, and **Focused**. The complete settings can control:

- writing instructions and response style;
- reasoning strength;
- temperature, Top P, Top K, and Min P;
- frequency, presence, and repetition penalties;
- character initiative and multi-character pacing;
- stop sequences and compatible provider-specific options;
- an optional context budget.

Context and output are uncapped by Harness Tavern by default where the provider protocol allows it. If you explicitly choose a context budget, complete context blocks may be omitted, but text is not cut through the middle of a block. A provider-truncated response is treated as incomplete instead of being displayed as a finished character reply.

You can save the current settings as a reusable preset. SillyTavern Chat Completion and Text Completion preset JSON files can also be previewed and imported; credentials, model selection, and output-token limits are excluded from that mapping.

## Move from SillyTavern

Open **Settings → Import from SillyTavern** and choose one of:

- a Character Card JSON, PNG, or CHARX file;
- a SillyTavern backup ZIP;
- a SillyTavern user-data directory.

Harness Tavern shows a read-only preview before import. Review warnings and choose **Copy**, **Replace**, or **Skip** for conflicts. Character Cards become single-cast Stories, Groups become ensemble Stories, World Info becomes narrator-only Stories, and Chats become mapped Story Playthroughs. Personas, swipes, and compatible generation presets are retained. Secrets are excluded, and executable extension content is never trusted or run.

Read [Migration](MIGRATION.md) for the exact compatibility and rollback boundary.

## Add, edit, and share content

Open **Library → New Story** to create a blank Story, or choose **Import as Story** for existing content. A blank Story asks only for a title; it may start narrator-only, with one inline Cast member, or with an ensemble added later. Harness Tavern creates an empty `harness-tavern-story/v2` structure and does not invent authored fields from a brief or fixed prompt.

The complete Story workspace exposes Story identity, inline Cast fields, prompt layers, alternate greetings, Lore, Scenes, causal definitions, safe transforms, automations, and compatibility data. You can also edit a Story source with a text editor and Git. An optional extension may provide its own opinionated assistance, but the core Library always receives explicit standard Story content.

Use:

- **Public preview** for a revocable, player-safe discovery page;
- **Tavern pack** for a complete playable distribution snapshot;
- **Editable Story source** when another creator should inspect, version, or modify the work;
- **Portable playthrough** when the recipient should continue the same causal history.

See [Content authoring guide](CREATOR_GUIDE.md) and [Sharing and extensions](SHARING_AND_EXTENSIONS.md).

## Back up your Tavern

Your local data directory contains the SQLite database, encrypted credential envelopes, the credential key, and managed Story source files. Those pieces belong together for disaster recovery.

For a simple offline backup:

1. stop Harness Tavern;
2. copy the complete `~/.harness-tavern` directory to encrypted storage;
3. restart the application;
4. periodically restore the copy to an isolated location and run `npm run doctor` against it.

Portable full backups are designed for interoperable content transfer and intentionally omit provider credentials. They do not replace a tested copy of the complete data directory. See [Operations](OPERATIONS.md) for online backup and restore guidance.

## Update safely

Before updating:

1. read the [Changelog](../CHANGELOG.md);
2. make a verified backup of the complete data directory;
3. stop the running process;
4. update the checkout and install the exact lockfile;
5. run the diagnostic before continuing.

```bash
git pull --ff-only
npm ci
npm run doctor
npm start
```

## Common problems

### The page does not open

Confirm that the terminal still shows a running server and that you opened `http://127.0.0.1:8787`, not an HTTPS address. If port 8787 is already in use, set another port before startup:

```bash
HT_PORT=8788 npm start
```

### A real model does not answer

Check that the connection is enabled, its endpoint and model name are correct, and the provider account has API access. Run `npm run doctor` for local integrity. Provider outages, account limits, content policies, and network failures remain controlled by the provider.

### A turn is shown as suspended

The command was preserved, but the model response was missing, malformed, contradictory, or incomplete. Correct the connection or model problem and resume the turn. Already committed Action effects will not be applied twice.

### Migration reports warnings

Warnings are part of the preview and receipt. They normally identify unsupported passive content, an invalid source file, or a Story-source synchronization problem. Keep the original SillyTavern data unchanged until you have inspected the imported library.

### I need help

Run:

```bash
npm run doctor
```

Then use [GitHub Discussions](https://github.com/HenryQUQ/harness-tavern/discussions) for setup questions or [GitHub Issues](https://github.com/HenryQUQ/harness-tavern/issues) for a reproducible defect. Share the version, operating system, Node.js version, steps, and redacted errors. Never attach API keys, `credentials.key`, a runtime database, or private transcripts.
