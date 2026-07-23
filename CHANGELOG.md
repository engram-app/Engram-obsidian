# Changelog

## [1.17.0](https://github.com/engram-app/Engram-obsidian/compare/1.16.0...1.17.0) (2026-07-23)


### Features

* **settings:** adopt getSettingDefinitions (Obsidian 1.13 search) ([#286](https://github.com/engram-app/Engram-obsidian/issues/286)) ([797b340](https://github.com/engram-app/Engram-obsidian/commit/797b340a1170f4be6e30342cfeb2faba6259810c))


### Bug Fixes

* **crdt:** skip remote-merge flush of empty body on never-seeded doc ([#288](https://github.com/engram-app/Engram-obsidian/issues/288)) ([#289](https://github.com/engram-app/Engram-obsidian/issues/289)) ([7990494](https://github.com/engram-app/Engram-obsidian/commit/79904944cbea572846764639086ab32fb09e6076))

## [1.16.0](https://github.com/engram-app/Engram-obsidian/compare/1.15.0...1.16.0) (2026-07-23)


### Features

* **sim:** deterministic CRDT convergence sim tier — differential gate for [#282](https://github.com/engram-app/Engram-obsidian/issues/282) ([#294](https://github.com/engram-app/Engram-obsidian/issues/294)) ([64c284d](https://github.com/engram-app/Engram-obsidian/commit/64c284d14789b3ac8427bee4ba88a3b75a69e2f0))
* **sim:** model editor enrollment → history-full notes; re-enable seeded random convergence suite ([#298](https://github.com/engram-app/Engram-obsidian/issues/298)) ([b7da6c8](https://github.com/engram-app/Engram-obsidian/commit/b7da6c869c561ffcd9b94b3716046527d33397c7))


### Bug Fixes

* **sync:** content-hash-aware equal-seq fence — an equal-seq row with new content is no longer dropped ([#296](https://github.com/engram-app/Engram-obsidian/issues/296)) ([fd1095a](https://github.com/engram-app/Engram-obsidian/commit/fd1095a9ae111f2636b9d657f9ec05bfafa735ab))

## [1.15.0](https://github.com/engram-app/Engram-obsidian/compare/1.14.0...1.15.0) (2026-07-22)


### Features

* delete the REST Yjs transport — socket is the only delta path (Phase E3) ([#293](https://github.com/engram-app/Engram-obsidian/issues/293)) ([f78ae97](https://github.com/engram-app/Engram-obsidian/commit/f78ae97e65db862b8f33cee5ec71ac03611817b5))
* **sync:** rename is one create op — delete the tombstone-resurrect dance (Phase E2) ([#292](https://github.com/engram-app/Engram-obsidian/issues/292)) ([f9087eb](https://github.com/engram-app/Engram-obsidian/commit/f9087ebafd66cd87c7008646d931eb5d746c123e))
* **sync:** seq gap-heal — live ops self-heal missed deliveries (pairs backend [#1058](https://github.com/engram-app/Engram-obsidian/issues/1058)) ([#278](https://github.com/engram-app/Engram-obsidian/issues/278)) ([a40092a](https://github.com/engram-app/Engram-obsidian/commit/a40092a4e54ddf0841f58e8948bd2f303bbe753e))
* **sync:** seq-diff vault validator — integer diff, bounded re-serve, head-equality heal skip (Phase E1) ([#291](https://github.com/engram-app/Engram-obsidian/issues/291)) ([f793df5](https://github.com/engram-app/Engram-obsidian/commit/f793df5b7c946877c45043bdb80c26b281c9a350))
* **sync:** socket-native live-bound converge — delete the REST backstop (single-path D3) ([#284](https://github.com/engram-app/Engram-obsidian/issues/284)) ([0007287](https://github.com/engram-app/Engram-obsidian/commit/0007287a862e85faed858989558ea469a1f8ccb5))


### Bug Fixes

* **api:** bound the five direct requestUrl call sites ([#279](https://github.com/engram-app/Engram-obsidian/issues/279)) ([6c572b0](https://github.com/engram-app/Engram-obsidian/commit/6c572b0f740b158c61329d7fdb830d1191b27883))
* **crdt:** deliver the vault fan-out to live-bound notes ([#264](https://github.com/engram-app/Engram-obsidian/issues/264)) ([689ee6d](https://github.com/engram-app/Engram-obsidian/commit/689ee6d887288439e8e8ce3f17304f553d977bb1))
* **sync:** converge CRDT backfill via Yjs deltas ([#281](https://github.com/engram-app/Engram-obsidian/issues/281)) ([fc44075](https://github.com/engram-app/Engram-obsidian/commit/fc440757c4e5875c21c3bf68f8bb17df2b6c2784))

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
