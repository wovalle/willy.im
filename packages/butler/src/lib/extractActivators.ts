import { ReminderActivators } from "../constants"
import { ICustomExtractor } from "../types"

type ActivatorExtractor = ICustomExtractor

export const extractActivators = (text: string): ActivatorExtractor => {
  for (const activator of ReminderActivators) {
    if (text.startsWith(activator)) {
      return {
        trigger: activator ?? "",
        from: 0,
        to: activator.length,
      }
    }
  }

  return {
    trigger: null,
    from: 0,
    to: 0,
  }
}
