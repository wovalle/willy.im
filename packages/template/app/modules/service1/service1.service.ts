import { declareService, type BaseServiceContext } from "../../lib/services"

export interface Service1 {
  dummyMethod(): string
}

export const createService1 = declareService<Service1>(
  "service1",
  (context: BaseServiceContext) => {
    return {
      dummyMethod(): string {
        context.logger.info("Service1 dummy method called")
        return "Hello from Service1!"
      },
    }
  }
)
