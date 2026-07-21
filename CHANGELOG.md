# Changelog

## [1.14.0](https://github.com/engram-app/Engram-obsidian/compare/1.13.2...1.14.0) (2026-07-21)


### Features

* **crdt:** create-before-edit — gate live send on create-ack (single-path D1) ([#266](https://github.com/engram-app/Engram-obsidian/issues/266)) ([dcaa5bb](https://github.com/engram-app/Engram-obsidian/commit/dcaa5bb417ac86cf12b84e4a6750a4b2404ea54c))


### Bug Fixes

* **ci:** enforce the no-bump rule and repo-qualify gh in the release job ([#273](https://github.com/engram-app/Engram-obsidian/issues/273)) ([55239b8](https://github.com/engram-app/Engram-obsidian/commit/55239b8c3769cb5fd3d4a2521885eb91d3010c82))

## [1.13.2](https://github.com/engram-app/Engram-obsidian/compare/1.13.0...1.13.2) (2026-07-21)


### Bug Fixes

* align local lint with the community scanner ([#271](https://github.com/engram-app/Engram-obsidian/issues/271)) ([0ae6a84](https://github.com/engram-app/Engram-obsidian/commit/0ae6a84b6e75a06bdd98425b4ab96f1812a14c57))
* **release:** guard fromJson so a release run does not fail the job ([#268](https://github.com/engram-app/Engram-obsidian/issues/268)) ([db51de9](https://github.com/engram-app/Engram-obsidian/commit/db51de9c7ef24c313523ce1d655e8c43e71dac0f))

## [1.13.0](https://github.com/engram-app/Engram-obsidian/compare/1.12.33...1.13.0) (2026-07-21)


### Features

* **release:** three-channel plugin release pipeline (per-PR / beta / stable) ([#250](https://github.com/engram-app/Engram-obsidian/issues/250)) ([555d14d](https://github.com/engram-app/Engram-obsidian/commit/555d14d803ac861cb479b4594ef5478c9fd1fa9a))


### Bug Fixes

* make bun.lock portable so the Obsidian scanner can resolve types ([#262](https://github.com/engram-app/Engram-obsidian/issues/262)) ([87f732b](https://github.com/engram-app/Engram-obsidian/commit/87f732bf2e8d8d7547cdfbd50d3f6070c18eb9de))
* **release:** write versions.json into the release PR, not post-merge ([#263](https://github.com/engram-app/Engram-obsidian/issues/263)) ([156abac](https://github.com/engram-app/Engram-obsidian/commit/156abace022aa21ba1a7824a4f4b58936cacbbbf))
