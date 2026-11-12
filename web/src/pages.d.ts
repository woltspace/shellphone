export type Change = { n: number; at?: number; by?: { kind: string; name: string }; op: unknown };
export const POLICY: string;
export function sealed(html: string): string;
export function after(have: Change[], got: Change[] | undefined): Change[];
