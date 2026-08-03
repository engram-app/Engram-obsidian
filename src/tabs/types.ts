import type { App } from "obsidian";
import type EngramSyncPlugin from "../main";

export interface TabContext {
	containerEl: HTMLElement;
	app: App;
	plugin: EngramSyncPlugin;
	redisplay: () => void;
	startDeviceFlow: () => Promise<void>;
	switchToTab: (tabId: string) => void;
}

export type TabRenderer = (ctx: TabContext) => void;
