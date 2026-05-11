import { spawn } from "node:child_process"

export function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let settled = false
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const timer = options.timeoutMs
      ? setTimeout(() => {
        if (settled) return
        settled = true
        child.kill("SIGTERM")
        reject(new Error(`${command} timed out after ${options.timeoutMs}ms`))
      }, options.timeoutMs)
      : null
    let stdout = ""
    let stderr = ""

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
      if (stdout.length > (options.maxStdout || 2_000_000)) stdout = stdout.slice(-(options.maxStdout || 2_000_000))
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
      if (stderr.length > (options.maxStderr || 12000)) stderr = stderr.slice(-(options.maxStderr || 12000))
    })
    child.on("error", (err) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      reject(err)
    })
    child.on("close", (code, signal) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        const reason = signal ? `signal ${signal}` : `exit code ${code}`
        reject(new Error(`${command} failed with ${reason}${stderr.trim() ? `:\n${stderr.trim()}` : ""}`))
      }
    })
  })
}
