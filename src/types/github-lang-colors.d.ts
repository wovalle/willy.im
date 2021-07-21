declare module "github-lang-colors" {
  export type GithubColor = {
    color: string
    url: string
  }

  export default function (color: string): string
}
