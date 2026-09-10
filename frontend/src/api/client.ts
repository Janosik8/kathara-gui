/**
 * Talking to the local backend.
 *
 * The server mints a session token at startup and opens the browser at
 * `/?token=...`. We capture it once, keep it in `sessionStorage` so a reload
 * does not lose it, and strip it from the visible URL — a token sitting in the
 * address bar invites being copied into a chat or a bug report.
 */

import type { Topology, TopologyState } from "../types";

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
    throw new ApiError(await readError(response), response.status);
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
    throw new ApiError(await readError(response), response.status);
  }
  return await response.blob();
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    const detail = body?.detail;
    if (typeof detail === "string") return detail;
    // FastAPI validation errors arrive as a list of per-field objects.
    if (Array.isArray(detail) && detail.length > 0) {
      return String(detail[0]?.msg ?? "").replace(/^Value error, /, "") || response.statusText;
    }
  } catch {
    // Fall through to the status text.
  }
  return response.statusText || `Request failed (${response.status})`;
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
}

export interface Conflicts {
  lab_name: string;
  /** Existing devices that are also in the topology being deployed. */
  expected: string[];
  /** Present under this lab name but absent from it — probably another lab. */
  unexpected: string[];
}

export interface StatusResponse {
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
  /** Absolute path of the `.kgui` this was saved to, or null if never saved. */
  project_file: string | null;
  dirty: boolean;
  features: Features;
  workspace: string;
}

export interface PackageSummary {
  filename: string;
  /** The scenario's own name, which need not match the file it lives in. */
  name: string;
  modified: number;
  size: number;
}

export interface SaveResponse {
  path: string;
  filename: string;
}

export interface OpenResponse {
  topology: Topology;
  features: Features;
  project_file: string;
  lab_dir: string;
  application: string;
  created: string | null;
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
  lab_dir: string;
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

  importLabConf: (text: string) =>
    request<ImportResponse>("/api/topology/import", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),

  exportLabConf: () => request<{ text: string }>("/api/topology/export"),

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

  verify: (topology: Topology) =>
    request<DiagnosticsResponse>("/api/lab/verify", {
      method: "POST",
      body: JSON.stringify({ topology }),
    }),

  // -- the scenario as a file -------------------------------------------

  projectState: () => request<ProjectState>("/api/project"),

  packages: () => request<PackageSummary[]>("/api/project/packages"),

  /** Write the scenario into the workspace, keeping it on this machine. */
  saveProject: (topology: Topology, filename?: string) =>
    request<SaveResponse>("/api/project/save", {
      method: "POST",
      body: JSON.stringify({ topology, filename: filename ?? null }),
    }),

  openProject: (filename: string) =>
    request<OpenResponse>("/api/project/open", {
      method: "POST",
      body: JSON.stringify({ filename }),
    }),

  /** The scenario as bytes, for handing to the browser's download. */
  downloadProject: (topology: Topology, filename?: string) =>
    requestBlob("/api/project/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topology, filename: filename ?? null }),
    }),

  /**
   * Open a package from outside the workspace — the instructor receiving a
   * submission. Sent as raw bytes, so the file name travels in a header.
   */
  uploadProject: (file: File) =>
    request<OpenResponse>("/api/project/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-KGUI-Filename": encodeURIComponent(file.name),
      },
      body: file,
    }),

  /** Pull each running device's configuration into the lab directory. */
  captureState: (topology: Topology) =>
    request<CaptureResponse>("/api/project/capture", {
      method: "POST",
      body: JSON.stringify({ topology }),
    }),
};
