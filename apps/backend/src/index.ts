import express from "express";
import { spawn, ChildProcess } from "child_process";
import { readdirSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = process.env.SCRIPTS_DIR || path.resolve(__dirname, "../../../scripts");

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || "3000", 10);

interface RunningTask {
  pid: number;
  startedAt: string;
  process: ChildProcess;
  stdout: string;
  stderr: string;
}

// Track running processes keyed by script name (one per script)
const running = new Map<string, RunningTask>();

function startScript(
  scriptName: string,
  scriptPath: string,
  args: string[],
  env: Record<string, string | undefined>
): RunningTask {
  const child = spawn("bash", [scriptPath, ...args], {
    env,
    cwd: path.resolve(__dirname, "../../.."),
  });

  const task: RunningTask = {
    pid: child.pid!,
    startedAt: new Date().toISOString(),
    process: child,
    stdout: "",
    stderr: "",
  };

  child.stdout.on("data", (data) => {
    task.stdout += data.toString();
    // Keep last 50KB to avoid memory bloat on long-running scripts
    if (task.stdout.length > 50_000) {
      task.stdout = task.stdout.slice(-40_000);
    }
  });

  child.stderr.on("data", (data) => {
    task.stderr += data.toString();
    if (task.stderr.length > 50_000) {
      task.stderr = task.stderr.slice(-40_000);
    }
  });

  child.on("close", (code) => {
    console.log(`[${scriptName}] exited with code ${code}`);
    running.delete(scriptName);
  });

  child.on("error", (err) => {
    console.error(`[${scriptName}] error: ${err.message}`);
    running.delete(scriptName);
  });

  running.set(scriptName, task);
  return task;
}

function killTask(scriptName: string): boolean {
  const task = running.get(scriptName);
  if (!task) return false;
  task.process.kill("SIGTERM");
  // Force kill after 5s if still alive
  setTimeout(() => {
    if (running.has(scriptName)) {
      task.process.kill("SIGKILL");
      running.delete(scriptName);
    }
  }, 5000);
  return true;
}

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

// List available scripts
app.get("/scripts", (_req, res) => {
  const files = readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith(".sh"));
  res.json({ scripts: files });
});

// Run a script by name
// Query params:
//   ?if_running=kill     — kill existing, don't restart
//   ?if_running=restart  — kill existing and start new one
//   (default)            — reject if already running
app.post("/scripts/:name", (req, res) => {
  const scriptName = req.params.name;
  const ifRunning = (req.query.if_running as string) || "";

  if (scriptName.includes("/") || scriptName.includes("..")) {
    res.status(400).json({ error: "Invalid script name" });
    return;
  }

  const scriptPath = path.join(SCRIPTS_DIR, scriptName);

  if (!existsSync(scriptPath)) {
    res.status(404).json({ error: `Script '${scriptName}' not found` });
    return;
  }

  const existing = running.get(scriptName);

  if (existing) {
    if (ifRunning === "kill") {
      killTask(scriptName);
      res.json({
        action: "killed",
        script: scriptName,
        pid: existing.pid,
      });
      return;
    }

    if (ifRunning === "restart") {
      killTask(scriptName);
      // Small delay to let the process die before restarting
      setTimeout(() => {
        const args = (req.body?.args as string[]) || [];
        const env = {
          ...process.env,
          ...((req.body?.env as Record<string, string>) || {}),
        };
        const task = startScript(scriptName, scriptPath, args, env);
        res.json({
          action: "restarted",
          script: scriptName,
          pid: task.pid,
          startedAt: task.startedAt,
        });
      }, 500);
      return;
    }

    // Default: reject
    res.status(409).json({
      error: `Script '${scriptName}' is already running`,
      pid: existing.pid,
      startedAt: existing.startedAt,
      hint: "Use ?if_running=restart to restart or ?if_running=kill to stop it",
    });
    return;
  }

  const args = (req.body?.args as string[]) || [];
  const env = {
    ...process.env,
    ...((req.body?.env as Record<string, string>) || {}),
  };

  const task = startScript(scriptName, scriptPath, args, env);

  res.json({
    action: "started",
    script: scriptName,
    pid: task.pid,
    startedAt: task.startedAt,
  });
});

// List running scripts with output tails
app.get("/running", (_req, res) => {
  const tasks: Record<string, object> = {};
  for (const [name, task] of running) {
    tasks[name] = {
      pid: task.pid,
      startedAt: task.startedAt,
      stdoutTail: task.stdout.slice(-2000),
      stderrTail: task.stderr.slice(-2000),
    };
  }
  res.json({ tasks });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`arena-backend listening on :${PORT}`);
  console.log(`scripts dir: ${SCRIPTS_DIR}`);
});
