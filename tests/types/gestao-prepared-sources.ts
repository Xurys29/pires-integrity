// Compile-only contract regression. No HTTP, credentials or private originals.
// Run with an existing Deno runtime:
//   deno check tests/types/gestao-prepared-sources.ts
import { createGestaoHandler } from "../../supabase/functions/_shared/gestao-api-core.mjs";

// Extract this unary JS factory's object parameter directly. Under Deno 2.9.8,
// Parameters<typeof createGestaoHandler> collapses to never, while this callable
// shape preserves the actual exported options without widening their types.
type HandlerOptions = typeof createGestaoHandler extends (options: infer Options) => unknown ? Options : never;
type PreparedSourceReferences = NonNullable<HandlerOptions["preparedSources"]>;
type PreparedSourceReference = PreparedSourceReferences[number];

type Assert<T extends true> = T;
type Extends<A, B> = [A] extends [B] ? true : false;
type Not<T extends boolean> = T extends true ? false : true;
type IsAny<T> = 0 extends (1 & T) ? true : false;
type IsNever<T> = [T] extends [never] ? true : false;
type IsUnknown<T> = unknown extends T
  ? [keyof T] extends [never] ? true : false
  : false;

// Real assignments require the exported metadata contract to accept valid data.
// A readonly input is valid because the handler only reads/maps references.
export const populatedReferences: PreparedSourceReferences = [
  { id: "fixture-prepared-source", name: "FIXTURE-ONLY.pdf" },
];
export const readonlyReferences: PreparedSourceReferences = Object.freeze([
  { id: "fixture-readonly-source", name: "FIXTURE-ONLY.xlsx" },
]);

export type PreparedSourceContractChecks = [
  Assert<Extends<{}, Pick<HandlerOptions, "preparedSources">>>,
  Assert<Not<IsAny<PreparedSourceReferences>>>,
  Assert<Not<IsAny<PreparedSourceReference>>>,
  Assert<Not<IsNever<PreparedSourceReference>>>,
  Assert<Not<IsUnknown<PreparedSourceReference>>>,
  Assert<Extends<PreparedSourceReference, { id: string; name: string }>>,
  Assert<Extends<{ id: string; name: string }[], PreparedSourceReferences>>,
  Assert<Extends<readonly { id: string; name: string }[], PreparedSourceReferences>>,
  Assert<Not<Extends<{ id: number; name: string }[], PreparedSourceReferences>>>,
  Assert<Not<Extends<{ id: string; name: number }[], PreparedSourceReferences>>>,
  Assert<Not<Extends<{ id: string }[], PreparedSourceReferences>>>,
  Assert<Not<Extends<unknown[], PreparedSourceReferences>>>,
];

