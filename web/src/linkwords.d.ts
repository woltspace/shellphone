export type Info = { linked: boolean; relay?: string; link?: string; invite?: string; guests?: number; error?: string; note?: string; via?: string; fixed?: boolean; unknown?: boolean };
export function unlinkedWords(info: Info, note: string, busy: unknown): { text: string; warn: boolean };
export function after(info: Info, got: Info | null): { info: Info; note: string };
export function settled(info: Info, got: Info | null, fresh: Info | null): { info: Info; note: string };
export function answered(read: boolean, status: number, body: unknown): Info | null;
