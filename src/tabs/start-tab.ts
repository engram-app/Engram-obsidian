/** Choose which settings tab to show when the panel first opens.
 *
 *  New users (no backend configured) land on the Welcome page so they get
 *  oriented; anyone already connected opens straight on the Cloud tab. Pure so
 *  it can be unit-tested without the Obsidian DOM. */
export function pickInitialTab(settings: {
	apiUrl?: string;
	apiKey?: string;
	refreshToken?: string;
}): "about" | "account" {
	const configured = !!settings.apiUrl && (!!settings.apiKey || !!settings.refreshToken);
	return configured ? "account" : "about";
}
