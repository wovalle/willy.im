import { ICustomExtractor } from "../types"

const reminderActivators = ["remind me to", "remind me", "rm me", "remind me", "rmd me"]

type ActivatorExtractor = ICustomExtractor

export const extractActivators = (text: string): ActivatorExtractor => {
  for (const activator of reminderActivators) {
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
