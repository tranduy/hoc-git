import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { VaultError, type SecretProtector } from "./types.js";

const dpapiScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$mode = $env:TOOL_CHENH_DPAPI_MODE
$inputBytes = [Convert]::FromBase64String([Console]::In.ReadToEnd())
$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
if ($mode -eq 'protect') {
  $outputBytes = [System.Security.Cryptography.ProtectedData]::Protect($inputBytes, $null, $scope)
} elseif ($mode -eq 'unprotect') {
  $outputBytes = [System.Security.Cryptography.ProtectedData]::Unprotect($inputBytes, $null, $scope)
} else {
  throw 'invalid mode'
}
[Console]::Out.Write([Convert]::ToBase64String($outputBytes))
`;

async function invokeDpapi(mode: "protect" | "unprotect", input: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", dpapiScript], {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
      env: { ...process.env, TOOL_CHENH_DPAPI_MODE: mode }
    });
    const output: Buffer[] = [];
    let outputLength = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      outputLength += chunk.length;
      if (outputLength <= 1024 * 1024) output.push(chunk);
      else child.kill();
    });
    child.once("error", () => reject(new VaultError("VAULT_UNAVAILABLE")));
    child.once("close", (code) => {
      if (code !== 0 || outputLength > 1024 * 1024) {
        reject(new VaultError("VAULT_UNAVAILABLE"));
        return;
      }
      try {
        resolve(Buffer.from(Buffer.concat(output).toString("utf8"), "base64"));
      } catch {
        reject(new VaultError("VAULT_UNAVAILABLE"));
      }
    });
    child.stdin.end(Buffer.from(input).toString("base64"));
  });
}

export class DpapiProtector implements SecretProtector {
  protect(cleartext: Uint8Array): Promise<Uint8Array> {
    return invokeDpapi("protect", cleartext);
  }

  unprotect(ciphertext: Uint8Array): Promise<Uint8Array> {
    return invokeDpapi("unprotect", ciphertext);
  }
}
