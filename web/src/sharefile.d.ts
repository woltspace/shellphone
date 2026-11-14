export function fileName(url: string, name?: string): string;
export function load(url: string, name?: string): Promise<File>;
export function canShareFiles(): boolean;
export function share(url: string, name?: string): Promise<"shared" | "cancelled" | "downloaded" | "again">;
export function forget(): void;
export function kind(name: string, type?: string): string;
