/** `Promise.withResolvers` for a lib target without it (the plugin builds for
 *  ES2021): a promise plus the function that resolves it. */
export function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
