import type { ViewerMemory, ViewerState } from "../../contracts/model-tools.ts";
/** Derived context is private, bounded by the same lifetime as admitted evidence. */
export interface ViewerMemoryStore {
  read(member: string, binding: string): ViewerMemory | undefined;
  list(): ViewerMemory[];
  write(
    member: string,
    binding: string,
    values: ViewerState,
    expires: number,
    sourceMessageIds?: string[],
    kind?: "initial" | "updated",
  ): ViewerMemory;
  clear(): void;
}
