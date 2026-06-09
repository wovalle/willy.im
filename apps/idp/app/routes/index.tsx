import { ShieldCheck } from "lucide-react"
import { Button } from "~/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card"

export function meta() {
  return [
    { title: "idp.willy.im" },
    { name: "description", content: "Identity provider for willy.im" },
  ]
}

export default function Index() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="bg-primary/10 text-primary mb-2 flex size-10 items-center justify-center rounded-lg">
            <ShieldCheck className="size-5" />
          </div>
          <CardTitle>idp.willy.im</CardTitle>
          <CardDescription>Identity provider for willy.im — coming online.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Single sign-on across willy.im projects. Authentication arrives in the next phase.
          </p>
        </CardContent>
        <CardFooter>
          <Button className="w-full" disabled>
            Sign in
          </Button>
        </CardFooter>
      </Card>
    </main>
  )
}
