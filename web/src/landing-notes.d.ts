type Store = { keys(): Promise<readonly (Request | string)[]>; match(key: string): Promise<Response | undefined>; delete(key: string): Promise<boolean> };
export function pending(cache: Store, now?: number): Promise<{ url: string; tap?: string; key: string; at: number } | null>;
export function forget(cache: Store, key?: string, at?: number): Promise<void>;
