/** Per-path viewer refcount. A "viewer" is any live binding (editor pane or
 *  reading-view) currently holding a note open. While a path has at least one
 *  viewer, onFlushToDisk skips the disk write (the editor owns the file). When
 *  the last viewer releases, onLastRelease fires so the manager can do one
 *  final flush to disk. Keyed by viewId so multiple panes on the same path
 *  refcount correctly and dup bind/release are no-ops. */
export class ViewerRefcount {
	private readonly viewers = new Map<string, Set<string>>();
	private readonly onLastRelease: (path: string) => void;

	constructor(onLastRelease: (path: string) => void) {
		this.onLastRelease = onLastRelease;
	}

	bind(path: string, viewId: string): void {
		let set = this.viewers.get(path);
		if (!set) {
			set = new Set();
			this.viewers.set(path, set);
		}
		set.add(viewId);
	}

	release(path: string, viewId: string): void {
		const set = this.viewers.get(path);
		if (!set || !set.has(viewId)) return;
		set.delete(viewId);
		if (set.size === 0) {
			this.viewers.delete(path);
			this.onLastRelease(path);
		}
	}

	isBound(path: string): boolean {
		return (this.viewers.get(path)?.size ?? 0) > 0;
	}
}
