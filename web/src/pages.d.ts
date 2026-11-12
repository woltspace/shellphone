export type Change = { n: number; at?: number; by?: { kind: string; name: string }; op: unknown };
export const POLICY: string;
export function sealed(html: string): string;
export function after(have: Change[], got: Change[] | undefined): Change[];
export type Open = { v: number; title?: string; by?: string; html?: string; changes: Change[] };
export type Got = { v: number; title?: string; by?: string; html?: string; changes?: Change[] } | "missing" | null;
export function look(cur: Open, get: (after: number, v: number) => Promise<Got>): Promise<{ page?: Open; fresh?: Change[]; error?: "missing" | "unreachable" }>;
export function changeGate(id: string, clock?: () => number): (op: unknown) => string | null;
