/** Minimal mock of Obsidian API for unit tests. */

export class TFile {
	path: string;
	extension: string;
	stat: { mtime: number; ctime: number; size: number };
	basename: string;

	constructor(path: string, mtime: number = Date.now(), size = 100) {
		this.path = path;
		this.extension = path.split(".").pop() || "";
		this.basename =
			path
				.split("/")
				.pop()
				?.replace(/\.[^.]+$/, "") || "";
		this.stat = { mtime, ctime: mtime, size };
	}
}

export class TAbstractFile {
	path = "";
}

export class TFolder {
	path: string;
	children: any[];

	constructor(path: string, children: any[] = []) {
		this.path = path;
		this.children = children;
	}
}

interface CapturedButton {
	text: string;
	style: Record<string, string>;
	click: () => void;
}

interface CapturedNotice {
	message: string;
	duration?: number;
	buttons: CapturedButton[];
}

/** Records every Notice constructed during a test. Reset in beforeEach when
 *  asserting against it. Each entry captures the message, duration, and the
 *  list of buttons appended to noticeEl (text + click handlers), so tests can
 *  verify the central limit-toast handler wires the Upgrade button correctly. */
export const __noticeCapture: { notices: CapturedNotice[] } = { notices: [] };

export class Notice {
	noticeEl: {
		createEl: (
			tag: string,
			opts?: { text?: string; cls?: string },
		) => {
			style: Record<string, string>;
			addEventListener: (e: string, cb: () => void) => void;
		};
	};

	constructor(message: string, timeout?: number) {
		const entry: CapturedNotice = { message, duration: timeout, buttons: [] };
		__noticeCapture.notices.push(entry);
		this.noticeEl = {
			createEl: (_tag, opts) => {
				const btn: CapturedButton = {
					text: opts?.text ?? "",
					style: {},
					click: () => {},
				};
				entry.buttons.push(btn);
				return {
					style: btn.style,
					addEventListener: (_evt: string, cb: () => void) => {
						btn.click = cb;
					},
				};
			},
		};
	}
}

export class Plugin {
	app: any = {};
	async loadData(): Promise<any> {
		return {};
	}
	async saveData(_data: any): Promise<void> {}
	addSettingTab(_tab: any): void {}
	addCommand(_cmd: any): void {}
	addStatusBarItem(): any {
		return { setText: () => {} };
	}
	registerEvent(_evt: any): void {}
}

export class PluginSettingTab {
	containerEl: any = {
		empty: () => {},
		createEl: () => ({ setText: () => {} }),
	};
	constructor(_app: any, _plugin: any) {}
}

/** Chainable DOM-element stub used by the Setting mock. */
export function makeEl(): any {
	const el: any = {
		// Real elements get detached; code under test calls this on placeholders
		// it swaps out. Without it the failure reads as an unrelated TypeError
		// deep inside a .catch, which is a miserable thing to debug.
		remove: () => el,
		empty: () => el,
		addEventListener: () => el,
		addClass: () => el,
		removeClass: () => el,
		removeClasses: () => el,
		setText: (t: string) => {
			el.textContent = t;
			return el;
		},
		setAttribute: () => el,
		textContent: "",
		createDiv: () => makeEl(),
		createSpan: () => makeEl(),
		createEl: () => makeEl(),
	};
	return el;
}

class TextComponent {
	value = "";
	changeCb: ((v: string) => void) | null = null;
	// Real Obsidian TextComponents expose the underlying <input>, and callers
	// attach listeners to it (blur, keydown). Without addEventListener here a
	// component doing that throws mid-render, and the failure surfaces as a
	// confusing "the field was never captured" rather than as itself.
	blurCb: (() => void) | null = null;
	inputEl: any = {
		type: "text",
		addClass: () => {},
		addEventListener: (evt: string, cb: () => void) => {
			if (evt === "blur") this.blurCb = cb;
		},
	};
	setPlaceholder(_p: string): this {
		return this;
	}
	setValue(v: string): this {
		this.value = v;
		return this;
	}
	getValue(): string {
		return this.value;
	}
	onChange(cb: (v: string) => void): this {
		this.changeCb = cb;
		return this;
	}
}

class ButtonComponent {
	clickCb: (() => void) | null = null;
	setButtonText(_t: string): this {
		return this;
	}
	setCta(): this {
		return this;
	}
	setWarning(): this {
		return this;
	}
	onClick(cb: () => void): this {
		this.clickCb = cb;
		return this;
	}
}

/** Components created during the last render, for assertions in tests.
 *  Reset it in a beforeEach when rendering Settings. */
export const __settingCapture: {
	texts: TextComponent[];
	buttons: ButtonComponent[];
	// Section/row names, so a test can assert WHICH settings a tab rendered —
	// the only way to check progressive disclosure without a real DOM.
	names: string[];
} = {
	texts: [],
	buttons: [],
	names: [],
};

export class Setting {
	settingEl: any = makeEl();
	descEl: any = makeEl();
	controlEl: any = makeEl();
	constructor(_containerEl: any) {}
	setName(name: string): this {
		__settingCapture.names.push(name);
		return this;
	}
	setDesc(_desc: string): this {
		return this;
	}
	setHeading(): this {
		return this;
	}
	addText(cb: (t: TextComponent) => void): this {
		const t = new TextComponent();
		cb(t);
		__settingCapture.texts.push(t);
		return this;
	}
	addTextArea(_cb: any): this {
		return this;
	}
	addButton(cb: (b: ButtonComponent) => void): this {
		const b = new ButtonComponent();
		cb(b);
		__settingCapture.buttons.push(b);
		return this;
	}
	addDropdown(_cb: any): this {
		return this;
	}
}

export function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

export async function requestUrl(_opts: any): Promise<any> {
	return { status: 200, json: {} };
}

export class FileSystemAdapter {
	getBasePath(): string {
		return "/mock/vault";
	}
}

export class Modal {
	app: any;
	contentEl: any = {
		empty: () => {},
		createEl: (_tag: string, _opts?: any) => ({
			setText: () => {},
			style: {},
		}),
		createDiv: (_opts?: any) => ({
			createEl: (_tag: string, _opts2?: any) => ({
				setText: () => {},
				addEventListener: () => {},
				style: {},
			}),
			style: {},
		}),
	};
	constructor(app: any) {
		this.app = app;
	}
	open(): void {}
	close(): void {}
}

export class ItemView {
	app: any;
	containerEl: any = {
		children: [
			null,
			{
				empty: () => {},
				addClass: () => {},
				createEl: (_tag: string, _opts?: any) => ({
					addEventListener: () => {},
					focus: () => {},
					style: {},
				}),
				createDiv: (_opts?: any) => ({
					empty: () => {},
					createEl: (_tag: string, _opts2?: any) => ({
						addEventListener: () => {},
						style: {},
					}),
					createDiv: (_opts2?: any) => ({
						createEl: () => ({ addEventListener: () => {}, style: {} }),
						addEventListener: () => {},
					}),
				}),
			},
		],
	};
	leaf: any;
	constructor(leaf: any) {
		this.leaf = leaf;
		this.app = leaf?.app || {};
	}
	getViewType(): string {
		return "";
	}
	getDisplayText(): string {
		return "";
	}
	getIcon(): string {
		return "";
	}
}

export class WorkspaceLeaf {
	app: any;
	constructor(app?: any) {
		this.app = app || {};
	}
}

export class MarkdownView {
	editor: any = { setValue: () => {} };
	file: TFile | null = null;
}

/** Stub of Obsidian's CM6 StateField carrying the active MarkdownFileInfo. The
 *  live-binding ViewPlugin reads it via `state.field(editorInfoField, false)`,
 *  but unit tests never mount that plugin against a real editor, so this only
 *  needs to exist so `import { editorInfoField } from "obsidian"` resolves. */
export const editorInfoField = { __editorInfoField: true } as const;

export const Platform = {
	isMobile: false,
	isMobileApp: false,
	isDesktop: true,
	isDesktopApp: true,
};

export function setIcon(_el: unknown, _name: string): void {
	// no-op for unit tests — real obsidian.setIcon mounts an SVG, but
	// nothing we test asserts against the rendered icon.
}

/** Mirrors Obsidian's getAllTags: merges inline cache tags + frontmatter tags,
 *  each returned with a leading '#'. Returns null when there are none. */
export function getAllTags(cache: {
	tags?: { tag: string }[];
	frontmatter?: { tags?: unknown };
}): string[] | null {
	const out: string[] = [];
	for (const t of cache?.tags ?? []) out.push(t.tag);
	const fm = cache?.frontmatter?.tags;
	if (Array.isArray(fm)) for (const t of fm) out.push(`#${String(t).replace(/^#/, "")}`);
	else if (typeof fm === "string") out.push(`#${fm.replace(/^#/, "")}`);
	return out.length ? out : null;
}

export class App {}

/** Test stub for Obsidian's AbstractInputSuggest. Only needs to resolve the
 *  import + provide setValue/getValue/close so subclasses can extend it; the
 *  pure suggestion logic is unit-tested directly, not through this base. */
export class AbstractInputSuggest<T> {
	protected inputEl: { value: string };
	constructor(_app: unknown, inputEl: { value: string }) {
		this.inputEl = inputEl ?? { value: "" };
	}
	setValue(value: string): void {
		this.inputEl.value = value;
	}
	getValue(): string {
		return this.inputEl.value;
	}
	close(): void {
		// no-op stub
	}
	getSuggestions(_query: string): T[] | Promise<T[]> {
		return [];
	}
}

/** Test stub. Real ranking is exercised via an injected fuzzy factory in
 *  search-engine tests; this only needs to resolve the import. */
export function prepareSimpleSearch(
	query: string,
): (text: string) => { score: number; matches: [number, number][] } | null {
	const q = query.toLowerCase();
	return (text: string) => {
		const i = text.toLowerCase().indexOf(q);
		if (i < 0) return null;
		return { score: 1, matches: [[i, i + q.length]] };
	};
}
