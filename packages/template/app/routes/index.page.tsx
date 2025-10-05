import type { Route } from "./+types/index.page"

export const loader = async ({ context }: Route.LoaderArgs) => {
  const dummy = context.services.service1.dummyMethod()

  return {
    dummy,
  }
}

export default function Index({ loaderData }: Route.ComponentProps) {
  return (
    <article className="flex flex-grow flex-col gap-24 px-6 py-16">
      Hi there {loaderData.dummy}!
    </article>
  )
}
