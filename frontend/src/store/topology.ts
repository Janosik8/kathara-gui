/**
 * The editor store: current topology, undo history, and the operation log.
 *
 * Undo keeps snapshots rather than inverting operations. Inverses are easy to
 * get subtly wrong (an inverse of `removeNode` must restore interfaces, order
 * and position), and a topology is small enough that snapshots cost nothing.
 * The operation log is kept alongside regardless, because that is what
 * Capability 7 will synchronise.
 */

import { create } from "zustand";
import { type Topology, emptyTopology } from "../types";
import { type Operation, OperationError, apply, describe } from "./operations";

/** Bounded so a long editing session cannot grow without limit. */
const MAX_HISTORY = 100;

export interface TopologyStore {
  topology: Topology;
  /** Every operation applied this session, oldest first. */
  log: Operation[];
  /** Description of the most recent change, for the live region. */
  lastAnnouncement: string | null;
  /** Message from the last rejected operation, for the live region. */
  error: string | null;
  dirty: boolean;

  past: Topology[];
  future: Topology[];

  dispatch: (op: Operation) => boolean;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /** Load a topology from the server without polluting undo history. */
  load: (topology: Topology) => void;
  clearError: () => void;
}

export const useTopologyStore = create<TopologyStore>((set, get) => ({
  topology: emptyTopology(),
  log: [],
  lastAnnouncement: null,
  error: null,
  dirty: false,
  past: [],
  future: [],

  dispatch: (op) => {
    const state = get();
    let next: Topology;
    try {
      next = apply(state.topology, op);
    } catch (err) {
      // A rejected edit is normal (duplicate name, occupied interface). It is
      // reported to the user, not thrown at them.
      if (err instanceof OperationError) {
        set({ error: err.message });
        return false;
      }
      throw err;
    }

    set({
      topology: next,
      log: [...state.log, op],
      past: [...state.past, state.topology].slice(-MAX_HISTORY),
      future: [], // a new edit invalidates the redo branch
      lastAnnouncement: describe(op),
      error: null,
      dirty: true,
    });
    return true;
  },

  undo: () => {
    const { past, topology, future } = get();
    const previous = past[past.length - 1];
    if (previous === undefined) return;
    set({
      topology: previous,
      past: past.slice(0, -1),
      future: [topology, ...future],
      lastAnnouncement: "Undid the last change",
      dirty: true,
    });
  },

  redo: () => {
    const { past, topology, future } = get();
    const next = future[0];
    if (next === undefined) return;
    set({
      topology: next,
      past: [...past, topology],
      future: future.slice(1),
      lastAnnouncement: "Redid the last change",
      dirty: true,
    });
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  load: (topology) =>
    set({
      topology,
      log: [],
      past: [],
      future: [],
      lastAnnouncement: "Loaded topology",
      error: null,
      dirty: false,
    }),

  clearError: () => set({ error: null }),
}));
