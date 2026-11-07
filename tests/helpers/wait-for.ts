/** Wait until `cond` holds, polling every few ms; throws `label` after
 *  `timeoutMs`. Use instead of a fixed sleep: a fixed budget that fits an
 *  idle box is overrun on a loaded CI runner. */
export async function waitFor(
	cond: () => boolean | Promise<boolean>,
	label: string,
	timeoutMs = 2000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!(await cond())) {
		if (Date.now() > deadline) throw new Error(`waitFor timed out: ${label}`);
		await new Promise<void>((r) => setTimeout(r, 5));
	}
}
