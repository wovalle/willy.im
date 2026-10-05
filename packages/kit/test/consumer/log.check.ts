// Compile-time only: `@willyim/kit/log` resolves through the package's exports.
import { configureLog, getLogger, nullLogger, withLogContext, type ILogger } from "@willyim/kit/log"

configureLog({ app: "todos", level: "debug" })
const log = getLogger("todos").with({ thread: "t1" })
// An app's existing ILogger parameter takes a kit logger.
const take = (l: ILogger) => l.info("todo.created", { id: "1" })
take(log)
take(nullLogger)
export const n: number = withLogContext({ request: "q1" }, () => 1)
// @ts-expect-error a logger has no `trace`
log.trace("x")
