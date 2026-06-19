"use client";

import { useState } from "react";

/** Toggle an id in a selection set, returning a new set (immutable update). */
export function toggleInSet(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

/**
 * Multi-select state for the host console: the queue selection and the file
 * selection (the latter is also consumed by the file library and queue actions,
 * so it's owned here and injected where needed). `toggle` is the shared
 * immutable set-toggle helper.
 */
export function useQueueSelection() {
  const [queueSel, setQueueSel] = useState<Set<string>>(new Set());
  const [filesSel, setFilesSel] = useState<Set<string>>(new Set());

  return { queueSel, setQueueSel, filesSel, setFilesSel, toggle: toggleInSet };
}
