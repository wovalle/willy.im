import type { BaseServiceContext, ILogger } from "../../app/lib/services"

type TaskFn = (ctx: BaseServiceContext) => Promise<{ count: number }>

interface TaskResult {
  success: boolean
  count: number
  error: string | null
  durationMs: number
}

export async function runTasks(
  tasks: Record<string, TaskFn>,
  ctx: BaseServiceContext,
  logger: ILogger,
): Promise<Record<string, TaskResult>> {
  const results: Record<string, TaskResult> = {}

  for (const [name, taskFn] of Object.entries(tasks)) {
    const start = Date.now()
    try {
      const { count } = await taskFn(ctx)
      const durationMs = Date.now() - start
      results[name] = { success: true, count, error: null, durationMs }
    } catch (error) {
      const durationMs = Date.now() - start
      const message = error instanceof Error ? error.message : "Unknown error"
      results[name] = { success: false, count: 0, error: message, durationMs }
      logger.error(`[scheduled] [${name}] Failed after ${durationMs}ms: ${message}`, error)
    }
  }

  return results
}
