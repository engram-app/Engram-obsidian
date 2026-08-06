# Changelog

## [1.20.1](https://github.com/engram-app/Engram-obsidian/compare/1.20.0...1.20.1) (2026-08-06)


### Bug Fixes

* **crdt:** stop dropping inserts at the frontmatter boundary (first-line typing corruption) ([#396](https://github.com/engram-app/Engram-obsidian/issues/396)) ([9d4f1e4](https://github.com/engram-app/Engram-obsidian/commit/9d4f1e4a7b5fca404e7a15b4c22a5e69de0f2d56))
* **sync:** id-keyed move must not discard content over an EMPTY target ([#394](https://github.com/engram-app/Engram-obsidian/issues/394)) ([efee0b6](https://github.com/engram-app/Engram-obsidian/commit/efee0b6d088de414e244f7edbca6e99090ad2899))

## [1.20.0](https://github.com/engram-app/Engram-obsidian/compare/1.19.0...1.20.0) (2026-08-05)


### Features

* **crdt:** make LCA three-way merge the default path ([#368](https://github.com/engram-app/Engram-obsidian/issues/368)) ([90b2127](https://github.com/engram-app/Engram-obsidian/commit/90b21279cc73b2284cfcbe08799f2dc81dd69bae)), closes [#364](https://github.com/engram-app/Engram-obsidian/issues/364)
* tag crdt join with client_type obsidian ([#389](https://github.com/engram-app/Engram-obsidian/issues/389)) ([a8ad8ab](https://github.com/engram-app/Engram-obsidian/commit/a8ad8abf858794134a96dc5465206e8bce94c752))


### Bug Fixes

* **deps:** clear three new audit advisories ([#385](https://github.com/engram-app/Engram-obsidian/issues/385)) ([a04129e](https://github.com/engram-app/Engram-obsidian/commit/a04129e120e658f5baf6c4125df3322924a11a24))
* repo-review remediation — safety/correctness fixes, dead-code purge, DRY consolidation ([#374](https://github.com/engram-app/Engram-obsidian/issues/374)) ([1baf9ad](https://github.com/engram-app/Engram-obsidian/commit/1baf9adacbe61d6c198bef69896ae14be39b4a97))
* **settings:** isConnected guard on the progress bar ([#379](https://github.com/engram-app/Engram-obsidian/issues/379)) ([bcaad06](https://github.com/engram-app/Engram-obsidian/commit/bcaad06913f4b8bc2e5cee6af9bc350531233fbd)), closes [#375](https://github.com/engram-app/Engram-obsidian/issues/375)

## [1.19.0](https://github.com/engram-app/Engram-obsidian/compare/1.18.1...1.19.0) (2026-07-31)


### Features

* adopt six Relay sync patterns (audit wave) ([40e4012](https://github.com/engram-app/Engram-obsidian/commit/40e40122474cd2a1ad6be4e0321d00c9daf670fd)), closes [#355](https://github.com/engram-app/Engram-obsidian/issues/355) [#356](https://github.com/engram-app/Engram-obsidian/issues/356) [#357](https://github.com/engram-app/Engram-obsidian/issues/357) [#358](https://github.com/engram-app/Engram-obsidian/issues/358) [#359](https://github.com/engram-app/Engram-obsidian/issues/359) [#360](https://github.com/engram-app/Engram-obsidian/issues/360)
* **logging:** remoteLogLevel severity threshold for RemoteLogger ([#333](https://github.com/engram-app/Engram-obsidian/issues/333)) ([c884067](https://github.com/engram-app/Engram-obsidian/commit/c8840670b5c476d72484a96a0bde4ef297cd77c5))


### Bug Fixes

* **crdt:** classify handshake frames, ungate the syncStep2 reply too ([#337](https://github.com/engram-app/Engram-obsidian/issues/337)) ([61fa5d0](https://github.com/engram-app/Engram-obsidian/commit/61fa5d0104a4f4be0e6f8fe262fb5274a433de33))
* **crdt:** delete-time artifacts, Relay correctness primitives, and verbose logs that reach Loki ([#348](https://github.com/engram-app/Engram-obsidian/issues/348)) ([67dd39b](https://github.com/engram-app/Engram-obsidian/commit/67dd39bb9cea6bec553ebfcff2e8559d00a50a6d))
* stop the push debounce leaking a phantom pending entry ([#352](https://github.com/engram-app/Engram-obsidian/issues/352)) ([312faa7](https://github.com/engram-app/Engram-obsidian/commit/312faa7f4f32f97c6bf530730822db9c5f18430b))
* **sync:** sweep per-note CRDT maps in destroy() ([#366](https://github.com/engram-app/Engram-obsidian/issues/366)) ([f58b8c1](https://github.com/engram-app/Engram-obsidian/commit/f58b8c1126ee7a75fbbceeab94c76d272f36ff9f)), closes [#290](https://github.com/engram-app/Engram-obsidian/issues/290)

## [1.18.1](https://github.com/engram-app/Engram-obsidian/compare/1.18.0...1.18.1) (2026-07-26)


### Bug Fixes

* **auth:** never send a request with an empty bearer token ([#336](https://github.com/engram-app/Engram-obsidian/issues/336)) ([ffe55b9](https://github.com/engram-app/Engram-obsidian/commit/ffe55b992a221c7c01eb68ca14e6263daa3e89cc))
* **crdt:** never gate the syncStep1 pull on the create-ack ([#335](https://github.com/engram-app/Engram-obsidian/issues/335)) ([cba7e14](https://github.com/engram-app/Engram-obsidian/commit/cba7e14b23fba1c57db32176b8d83c252396f665))
* **crdt:** rebuild client on Relay's model ([#331](https://github.com/engram-app/Engram-obsidian/issues/331)) ([6a0e81d](https://github.com/engram-app/Engram-obsidian/commit/6a0e81da33285748f75e02670f02a05c19ceb858))
* **crdt:** recover offline edits after switch-away ([#325](https://github.com/engram-app/Engram-obsidian/issues/325)) ([3b87e48](https://github.com/engram-app/Engram-obsidian/commit/3b87e4877e8b18077f1018c833207dd2733276b7))

## [1.18.0](https://github.com/engram-app/Engram-obsidian/compare/1.17.0...1.18.0) (2026-07-25)


### Features

* **crdt:** canvas onto CRDT — structural Yjs sync ([#306](https://github.com/engram-app/Engram-obsidian/issues/306) Phase B, plugin) ([#321](https://github.com/engram-app/Engram-obsidian/issues/321)) ([65335e9](https://github.com/engram-app/Engram-obsidian/commit/65335e905f69f70b34cc0603ef0b908e5c35a927))
* modal-free drift-conflict-copy for CRDT md double-divergence (refs [#306](https://github.com/engram-app/Engram-obsidian/issues/306)) ([#320](https://github.com/engram-app/Engram-obsidian/issues/320)) ([c71b15b](https://github.com/engram-app/Engram-obsidian/commit/c71b15bd60bda75f4459d33bbdbb36f94dcb983f))
* sync preview on the op-log socket feed (redo of [#311](https://github.com/engram-app/Engram-obsidian/issues/311), startup + vault-switch fixed) ([#314](https://github.com/engram-app/Engram-obsidian/issues/314)) ([e7c9c87](https://github.com/engram-app/Engram-obsidian/commit/e7c9c87afefd5e8fe4fe9d3a9fb8747cc14c9256))
* sync preview on the op-log socket feed; delete /notes/changes + /attachments/changes client path ([#311](https://github.com/engram-app/Engram-obsidian/issues/311)) ([bb25db0](https://github.com/engram-app/Engram-obsidian/commit/bb25db0c36cc5a95fef29d22a70547d3a5d73fd2))
* thread + persist the composite {seq,id} catch-up cursor ([#312](https://github.com/engram-app/Engram-obsidian/issues/312)) ([#315](https://github.com/engram-app/Engram-obsidian/issues/315)) ([f1ccc95](https://github.com/engram-app/Engram-obsidian/commit/f1ccc95727a25f18d648852349e9b91a7e3dda57))


### Bug Fixes

* CRDT error guards — replay mint refusal, enrollment retry, frame/flush logging ([#302](https://github.com/engram-app/Engram-obsidian/issues/302)) ([b3ef617](https://github.com/engram-app/Engram-obsidian/commit/b3ef617eae8be972506c1a4db9372c2bfe1e2781))
* **deps:** clear brace-expansion audit via bx5 + minimatch10 overrides ([#324](https://github.com/engram-app/Engram-obsidian/issues/324)) ([13f9b21](https://github.com/engram-app/Engram-obsidian/commit/13f9b212994617602188069f9bcc7946303d79c9))
* release the transient heal room after convergence commits (e2e fan-out flake root cause) ([#307](https://github.com/engram-app/Engram-obsidian/issues/307)) ([014879a](https://github.com/engram-app/Engram-obsidian/commit/014879abf4f25fdc74de0d2406f3256d83d22007))
* **sync:** guard delete-reconcile against identity-swap race ([#283](https://github.com/engram-app/Engram-obsidian/issues/283)) ([#316](https://github.com/engram-app/Engram-obsidian/issues/316)) ([ee5a8f9](https://github.com/engram-app/Engram-obsidian/commit/ee5a8f92f83844368d2e8f212dc6f3b0fd4a85bb))

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
