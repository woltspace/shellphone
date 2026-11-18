export type Info = { linked: boolean; relay?: string; link?: string; invite?: string; guests?: number; error?: string; note?: string };
export function unlinkedWords(info: Info, note: string, busy: unknown): { text: string; warn: boolean };
export function after(info: Info, got: Info | null): { info: Info; note: string };
