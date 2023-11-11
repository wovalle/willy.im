import { Group, Paper, RingProgress, Stack, Text } from "@mantine/core"
import { IconMusic } from "@tabler/icons-react"

const stats = [
  {
    label: "Tracks",
    stats: 0,
    progress: 100,
    color: "blue",
    Icon: () => IconMusic,
  },
]
const stat = stats[0]

export const StatsBar = () => {
    
  return (
    <Stack>
      <Paper withBorder radius="md" p="xs" key={stat.label}>
        <Group>
          <RingProgress
            size={80}
            roundCaps
            thickness={8}
            sections={[{ value: stat.progress, color: stat.color }]}
            // label={
            //   // <Center>
            //   //   <stat.Icon style={{ width: rem(20), height: rem(20) }} stroke={1.5} />
            //   // </Center>
            // }
          />

          <div>
            <Text c="dimmed" size="xs" tt="uppercase" fw={700}>
              {stat.label}
            </Text>
            <Text fw={700} size="xl">
              {stat.stats}
            </Text>
          </div>
        </Group>
      </Paper>
    </Stack>
  )
}
