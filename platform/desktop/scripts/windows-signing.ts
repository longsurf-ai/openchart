// Purpose: Share explicit Windows signing configuration between Packager and Squirrel.
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

/**
 * Resolves operator-owned signing material without logging it. A custom CommonJS
 * hook receives each filename and may use a cloud signing service. Signed builds
 * fail before packaging when neither a hook nor certificate is configured.
 * No credentials are written to the app or release receipt.
 * @example const options = windowsSigning('signed');
 */
export function windowsSigning(mode: "signed" | "unsigned") {
  if (mode === "unsigned") return undefined;
  const hookModulePath = process.env.OPENCHART_WINDOWS_SIGN_HOOK;
  if (hookModulePath) {
    if (!isAbsolute(hookModulePath) || !existsSync(hookModulePath))
      throw new Error(
        "OPENCHART_WINDOWS_SIGN_HOOK must name an existing absolute signing module",
      );
    return { hookModulePath };
  }
  const certificateFile = process.env.WINDOWS_CERTIFICATE_FILE;
  if (
    !certificateFile ||
    !isAbsolute(certificateFile) ||
    !existsSync(certificateFile)
  )
    throw new Error(
      "Windows signing requires OPENCHART_WINDOWS_SIGN_HOOK or WINDOWS_CERTIFICATE_FILE; use explicit unsigned mode for test installers",
    );
  return {
    certificateFile,
    certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD,
  };
}
