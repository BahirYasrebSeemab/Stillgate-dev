export const PROTOCOL_VERSION = 1;
export const APP_VERSION = "0.1.0";

// Default network ports
export const DEFAULT_SERVER_PORT = 47800;
export const DEFAULT_SHELL_IPC_PORT = 47831;

// Unlock and maintenance durations, in seconds
export const MIN_UNLOCK_SEC = 60;
export const MAX_UNLOCK_SEC = 12 * 60 * 60;
export const DEFAULT_MAINTENANCE_SEC = 30 * 60;
export const EXPIRY_WARNING_SEC = 5 * 60;
export const REARM_RESTART_DELAY_SEC = 60;

// Size limits for incoming data
// (a full policy of 100 apps with long paths fits comfortably in 1 MiB)
export const MAX_MESSAGE_BYTES = 1024 * 1024;
export const MAX_SHELL_REQUEST_BYTES = 16 * 1024;
export const MAX_SHELL_PUSH_BYTES = 1024 * 1024;
export const MAX_EVENT_DETAIL_CHARS = 500;
export const MAX_POLICY_ITEMS = 100;
export const MAX_NAME_CHARS = 80;
export const MAX_PATH_CHARS = 260;
export const MAX_ARG_CHARS = 260;
export const MAX_SITE_PATTERN_CHARS = 253;
export const MAX_APP_ARGS = 20;

// Agent <-> server connection timing, in milliseconds
export const HEARTBEAT_INTERVAL_MS = 15_000;
export const OFFLINE_AFTER_MS = 45_000;
export const AUTH_TIMEOUT_MS = 10_000;
export const RECONNECT_MIN_MS = 1_000;
export const RECONNECT_MAX_MS = 60_000;
export const RECONNECT_JITTER = 0.2;

// Server-side limit on failed agent logins, per IP address
export const AUTH_FAIL_LIMIT = 10;
export const AUTH_FAIL_WINDOW_MS = 5 * 60_000;
export const AUTH_BLOCK_MS = 15 * 60_000;

// Restore password rules
export const MIN_PASSWORD_CHARS = 10;
export const MAX_PASSWORD_CHARS = 256;
export const PASSWORD_FREE_ATTEMPTS = 5;
export const PASSWORD_LOCKOUT_BASE_SEC = 60;
export const PASSWORD_LOCKOUT_MAX_SEC = 15 * 60;

// Pairing codes
export const PAIRING_CODE_LENGTH = 8;
export const PAIRING_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const PAIRING_CODE_TTL_MS = 10 * 60_000;

// Manager event log size
export const MAX_EVENT_LOG_ENTRIES = 5000;

// Microsoft Edge install location (sites open here). UNTESTED(windows): confirm on the PCs.
export const EDGE_APP_FOLDER = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application";
export const EDGE_EXE = `${EDGE_APP_FOLDER}\\msedge.exe`;
