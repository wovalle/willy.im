import { FC, ReactNode } from "react"
import classes from "./Navbar.module.css"

type LayoutProps = {
  children: ReactNode
  context: PageContext
}

import {
  ActionIcon,
  AppShell,
  Badge,
  Group,
  ScrollArea,
  Skeleton,
  Text,
  Tooltip,
  UnstyledButton,
  rem,
} from "@mantine/core"
import { useDisclosure } from "@mantine/hooks"
import { IconPlus } from "@tabler/icons-react"
import { PageContext, routes } from "../static"

const links = Object.entries(routes).map(([route, data]) => ({
  route,
  icon: data.icon,
  label: data.label,
  notifications: 3,
}))

export const Layout: FC<LayoutProps> = ({ children, context }) => {
  const [opened, { toggle }] = useDisclosure()

  const mainLinks = links.map((link) => (
    <UnstyledButton
      key={link.label}
      className={classes.mainLink}
      onClick={() => context.setRoute(link.route)}
    >
      <div className={classes.mainLinkInner}>
        <link.icon size={20} className={classes.mainLinkIcon} stroke={1.5} />
        <span>{link.label}</span>
      </div>
      {link.notifications && (
        <Badge size="sm" variant="filled" className={classes.mainLinkBadge}>
          {link.notifications}
        </Badge>
      )}
    </UnstyledButton>
  ))

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 300, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md">
          <div> goo</div>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="md">
        <AppShell.Section>Navbar header</AppShell.Section>
        <AppShell.Section>
          <div>{mainLinks}</div>
        </AppShell.Section>
        <AppShell.Section grow my="md" component={ScrollArea}>
          <Group className={classes.collectionsHeader} justify="space-between">
            <Text size="sm" fw={500}>
              User Generated
            </Text>
            <Tooltip label="Create collection" withArrow position="right">
              <ActionIcon variant="default" size={18}>
                <IconPlus style={{ width: rem(12), height: rem(12) }} stroke={1.5} />
              </ActionIcon>
            </Tooltip>
          </Group>

          {Array(4)
            .fill(0)
            .map((_, index) => (
              <Skeleton key={index} h={28} mt="sm" animate={false} />
            ))}
        </AppShell.Section>
        <AppShell.Section>Navbar footer – always at the bottom</AppShell.Section>
      </AppShell.Navbar>
      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  )
}
