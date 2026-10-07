// Purpose: Builds the sanitized environment the Claude CLI subprocess inherits from OpenChart.
import { platform } from "node:os";

const WINDOWS = platform() === "win32";

// The SDK replaces the subprocess environment with `env`, so the adapter
// assembles it from an allowlist instead of leaking the host's entire shell.
const INHERITED = WINDOWS
  ? [
      "APPDATA",
      "COMSPEC",
      "HOMEDRIVE",
      "HOMEPATH",
      "LOCALAPPDATA",
      "PATH",
      "PATHEXT",
      "SYSTEMDRIVE",
      "SYSTEMROOT",
      "TEMP",
      "TMP",
      "USERNAME",
      "USERPROFILE",
      "WINDIR",
    ]
  : [
      "HOME",
      "LOGNAME",
      "PATH",
      "SHELL",
      "TERM",
      "USER",
      "LANG",
      "LC_ALL",
      "TMPDIR",
    ];

// Native config location, proxy/TLS reachability, and cloud-provider routing.
const NAMED = [
  "CLAUDE_CONFIG_DIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "GCLOUD_PROJECT",
  "CLOUD_ML_REGION",
];

// Authentication and cloud credentials, e.g. ANTHROPIC_API_KEY, AWS_PROFILE.
const PREFIXES = ["ANTHROPIC_", "CLAUDE_", "AWS_", "GOOGLE_"];

/** Windows names are case-insensitive; match Node's first sorted alias rule. */
function windowsEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of Object.keys(source).sort()) {
    const name = key.toUpperCase();
    const value = source[key];
    if (typeof value === "string" && !Object.hasOwn(result, name))
      result[name] = value;
  }
  return result;
}

/**
 * Returns the allowlisted host environment merged with explicit overrides.
 * Exported shell functions never pass through. On Windows, matching and output
 * names are case-insensitive, with one uppercase key per variable. Aliases in
 * each source follow Node's first lexicographically sorted key; explicit
 * overrides replace inherited values regardless of casing. POSIX names retain
 * their original case-sensitive behavior. Performs no I/O and owns no resources.
 * @example const env = claudeEnvironment({ DISABLE_AUTOUPDATER: "1" });
 */
export function claudeEnvironment(
  overrides: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  const inherited = WINDOWS ? windowsEnvironment(process.env) : process.env;
  for (const [key, value] of Object.entries(inherited)) {
    if (typeof value !== "string" || value.startsWith("()")) continue;
    if (
      INHERITED.includes(key) ||
      NAMED.includes(key) ||
      PREFIXES.some((prefix) => key.startsWith(prefix))
    )
      env[key] = value;
  }
  return { ...env, ...(WINDOWS ? windowsEnvironment(overrides) : overrides) };
}
