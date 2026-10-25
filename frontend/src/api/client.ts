/**
 * Talking to the local backend.
 *
 * The server mints a session token at startup and opens the browser at
 * `/?token=...`. We capture it once, keep it in `sessionStorage` so a reload
 * does not lose it, and strip it from the visible URL — a token sitting in the
 * address bar invites being copied into a chat or a bug report.
 */

import type { Position, Topology, TopologyState } from "../types";

const TOKEN_KEY = "kgui.token";

function captureToken(): string | null {
  const fromUrl = new URLSearchParams(window.location.search).get("token");
  if (fromUrl) {
    sessionStorage.setItem(TOKEN_KEY, fromUrl);
    const clean = new URL(window.location.href);
    clean.searchParams.delete("token");
    window.history.replaceState({}, "", clean.toString());
    return fromUrl;
  }
  return sessionStorage.getItem(TOKEN_KEY);
}

let token: string | null = null;

export function initialiseToken(): void {
  token = captureToken();
}

/** Raised for a non-2xx response, carrying the backend's own wording. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /**
     * Where in the request a validation error (422) points, as FastAPI reports
     * it — e.g. ["body", "nodes", 0, "interfaces", 1, "ip"]. Lets the caller
     * name the device and interface, which the message alone does not.
     */
    readonly location: readonly (string | number)[] = [],
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (token === null) initialiseToken();

  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "X-KGUI-Token": token } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw await readError(response);
  }
  return (await response.json()) as T;
}

/**
 * Like `request`, but for endpoints that answer with a file.
 *
 * Kept separate rather than adding a flag: the JSON path must never try to
 * parse a zip, and a caller asking for bytes should say so at the call site.
 */
async function requestBlob(path: string, init: RequestInit = {}): Promise<Blob> {
  if (token === null) initialiseToken();

  const response = await fetch(path, {
    ...init,
    headers: {
      ...(token ? { "X-KGUI-Token": token } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw await readError(response);
  }
  return await response.blob();
}

async function readError(response: Response): Promise<ApiError> {
  const fallback = response.statusText || `Request failed (${response.status})`;
  try {
    const body = await response.json();
    const detail = body?.detail;
    if (typeof detail === "string") return new ApiError(detail, response.status);
    // FastAPI validation errors arrive as a list of per-field objects.
    if (Array.isArray(detail) && detail.length > 0) {
      const message = String(detail[0]?.msg ?? "").replace(/^Value error, /, "") || fallback;
      const location = Array.isArray(detail[0]?.loc) ? detail[0].loc : [];
      return new ApiError(message, response.status, location);
    }
  } catch {
    // Fall through to the status text.
  }
  return new ApiError(fallback, response.status);
}

export type IssueSeverity = "error" | "warning";

export interface AddressingIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  collision_domain: string | null;
  devices: string[];
}

export interface IssuesResponse {
  issues: AddressingIssue[];
  errors: number;
  warnings: number;
}

export interface AllocateResponse {
  topology: Topology;
  assigned_subnets: Record<string, string>;
  assigned_addresses: Record<string, string>;
  skipped: string[];
  /** "device:interface" -> the address it had, outside its domain's subnet (bug 33). */
  replaced?: Record<string, string>;
  changed: boolean;
}

export interface AllocateRequest {
  /** The document the editor holds. Omitting it allocates over the stale
   *  saved session, which silently discards unsaved edits. */
  topology: Topology;
  pool?: string;
  prefix?: number;
  overwrite?: boolean;
}

export interface EnvironmentCheck {
  name: string;
  status: "ok" | "blocked" | "advisory";
  detail: string;
  remedy: string;
}

export interface ProbeResponse {
  checks: EnvironmentCheck[];
  can_deploy: boolean;
}

/**
 * `exited` is a container that exists but has stopped — Docker does not
 * restart Kathará containers, so a daemon restart or a sleeping machine leaves
 * a lab here. It is not the same as `stopped`: the names are still taken.
 */
export type DeviceState = "running" | "stopped" | "exited" | "orphaned";

export interface DeviceStatus {
  name: string;
  state: DeviceState;
  /** Docker's container name, for `docker exec`. Absent when none exists. */
  container?: string | null;
  /** The shell Kathará configured for the device. */
  shell?: string | null;
}

export interface Conflicts {
  lab_name: string;
  /** Existing devices that are also in the topology being deployed. */
  expected: string[];
  /** Present under this lab name but absent from it — probably another lab. */
  unexpected: string[];
}

export interface StatusResponse {
  /** How the canvas differs from what is running, one sentence each. */
  drift: string[];
  devices: DeviceStatus[];
  running: string[];
  /** Devices whose containers exist but have stopped. */
  exited: string[];
  /** True when any container exists, running or exited. */
  deployed: boolean;
  lab_dir: string | null;
  message: string | null;
  needs_confirmation: boolean;
  conflicts: Conflicts | null;
}

/** Which assistive features this scenario permits (exam mode). */
export interface Features {
  subnet_calculator: boolean;
  addressing_validation: boolean;
  infrastructure_verification: boolean;
}

export interface ProjectState {
  name: string;
  /** Absolute path of the scenario folder, or null if never saved. */
  folder: string | null;
  dirty: boolean;
  features: Features;
  workspace: string;
}

export interface ScenarioSummary {
  /** Directory name inside the workspace. */
  folder: string;
  /** The scenario's own name, which need not match its folder. */
  name: string;
  devices: number;
  modified: number;
  /** True when the folder has no kgui.json — a lab from somewhere else. */
  foreign: boolean;
  /** True while any of its lab's containers is running. */
  running?: boolean;
}

export interface SaveResponse {
  folder: string;
  name: string;
  /** The folder's previous name, when saving renamed it to follow the lab's. */
  renamed_from?: string | null;
}

export interface OpenResponse {
  topology: Topology;
  features: Features;
  folder: string;
  /** Lines of lab.conf that could not be understood. Import is forgiving. */
  warnings: string[];
  foreign: boolean;
}

export interface CapturedFile {
  device: string;
  path: string;
  lines: number;
}

export interface CaptureResponse {
  captured: CapturedFile[];
  /** Devices nothing was taken from, paired with the reason. */
  skipped: [string, string][];
  message: string | null;
  folder: string;
  /** The topology with what the capture learned folded in. */
  topology: Topology;
}

export type LinkOutcome = "pass" | "fail" | "skipped";

export interface LinkCheck {
  collision_domain: string;
  source: string;
  source_interface: number;
  target: string;
  target_interface: number;
  target_address: string | null;
  outcome: LinkOutcome;
  detail: string;
}

export interface DiagnosticsResponse {
  checks: LinkCheck[];
  passed: number;
  failed: number;
  skipped: number;
  healthy: boolean;
  message: string | null;
}

/** Every Kathará lab of the current user, not only the one being edited. */
export interface EverythingResponse {
  devices: number;
  labs: number;
  message: string | null;
}

export interface FeaturesResponse {
  subnet_calculator: boolean;
  addressing_validation: boolean;
  infrastructure_verification: boolean;
}

export interface ImportResponse {
  topology: Topology;
  warnings: string[];
}

export const api = {
  health: () => request<{ status: string; version: string }>("/api/health"),

  read: () => request<TopologyState>("/api/topology"),

  save: (topology: Topology) =>
    request<TopologyState>("/api/topology", {
      method: "PUT",
      body: JSON.stringify(topology),
    }),

  reset: () => request<TopologyState>("/api/topology/reset", { method: "POST" }),

  /**
   * Positions that lay the whole topology out with as few link crossings as
   * possible. Returns positions, not a topology, so the editor applies them
   * as one `moveNodes` operation and one undo retracts the lot.
   */
  arrange: (topology: Topology) =>
    request<{ positions: Record<string, Position> }>("/api/topology/arrange", {
      method: "POST",
      body: JSON.stringify(topology),
    }),

  // lab.conf import and export live on /api/topology and remain part of the
  // HTTP surface, but the interface no longer offers them separately: a
  // scenario travels as a folder, and its zip already contains lab.conf.

  /**
   * Validate a topology without storing it.
   *
   * The rules live on the server so the editor and the exported lab can never
   * disagree; the browser sends whatever it currently holds.
   */
  checkAddressing: (topology: Topology) =>
    request<IssuesResponse>("/api/topology/addressing/check", {
      method: "POST",
      body: JSON.stringify(topology),
    }),

  allocateAddressing: (options: AllocateRequest) =>
    request<AllocateResponse>("/api/topology/addressing/allocate", {
      method: "POST",
      body: JSON.stringify(options),
    }),

  // -- lab -------------------------------------------------------------
  // Each of these carries the topology for the same reason allocation does:
  // the saved session lags behind whatever the editor is holding.

  probe: () => request<ProbeResponse>("/api/lab/probe"),

  features: () => request<FeaturesResponse>("/api/lab/features"),

  labStatus: (topology: Topology) =>
    request<StatusResponse>("/api/lab/status", {
      method: "POST",
      body: JSON.stringify({ topology }),
    }),

  /**
   * `confirm` stops whatever is already running under this lab name. Without
   * it the server reports the conflict and changes nothing.
   */
  deploy: (topology: Topology, confirm = false) =>
    request<StatusResponse>("/api/lab/deploy", {
      method: "POST",
      body: JSON.stringify({ topology, confirm }),
    }),

  undeploy: (topology: Topology) =>
    request<StatusResponse>("/api/lab/undeploy", {
      method: "POST",
      body: JSON.stringify({ topology }),
    }),

  /** How many devices, in how many labs, "Stop every lab" would stop. */
  labEverything: () => request<EverythingResponse>("/api/lab/everything"),

  /** Stop every lab of the current user, capturing nothing: `kathara wipe`. */
  wipeLabs: () => request<EverythingResponse>("/api/lab/wipe", { method: "POST" }),

  verify: (topology: Topology) =>
    request<DiagnosticsResponse>("/api/lab/verify", {
      method: "POST",
      body: JSON.stringify({ topology }),
    }),

  // -- the scenario as a folder -----------------------------------------

  projectState: () => request<ProjectState>("/api/project"),

  scenarios: () => request<ScenarioSummary[]>("/api/project/scenarios"),

  /** Write the scenario into its folder in the workspace. */
  saveProject: (topology: Topology, name?: string) =>
    request<SaveResponse>("/api/project/save", {
      method: "POST",
      body: JSON.stringify({ topology, name: name ?? null }),
    }),

  openProject: (folder: string) =>
    request<OpenResponse>("/api/project/open", {
      method: "POST",
      body: JSON.stringify({ folder }),
    }),

  /** The scenario as a zip, for the browser to hand to the user. */
  exportProject: (topology: Topology, name?: string) =>
    requestBlob("/api/project/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topology, name: name ?? null }),
    }),

  /**
   * Open a scenario from outside the workspace: a zip, or a bare lab.conf.
   * Sent as raw bytes, so the file name travels in a header.
   */
  /**
   * Import a zip or a bare `lab.conf`. A scenario of the same name already in
   * the workspace is answered with 409 unless `replace` (test 5C.1).
   */
  importProject: (file: File, replace = false) =>
    request<OpenResponse>(`/api/project/import${replace ? "?replace=true" : ""}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-KGUI-Filename": encodeURIComponent(file.name),
      },
      body: file,
    }),

  /** Pull each running device's live configuration into the scenario. */
  captureState: (topology: Topology) =>
    request<CaptureResponse>("/api/project/capture", {
      method: "POST",
      body: JSON.stringify({ topology }),
    }),
};
