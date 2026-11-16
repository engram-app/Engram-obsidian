/** Canonical folder path: no empty segments (leading, trailing or doubled
 *  slashes). "" means "no folder" and callers must skip it; creating a folder
 *  with an empty name is what produced the phantom folders on Android. */
export function cleanFolderPath(path: string): string {
	return path.split("/").filter(Boolean).join("/");
}
