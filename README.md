# sokoban-solver

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/Ajengayukusu/sokoban-solver/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/Ajengayukusu/sokoban-solver/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

A push-optimal Sokoban solver: every level is a hallway with independent rooms, so the level's push-optimal count is the sum of its rooms' optima. The solver splits a level into rooms, solves each room with push-based A* search (a state is the boxes plus the player's reachable region, a step is one push, the estimate is the cheapest box-to-goal matching, with dead-square and 2x2 freeze pruning), then walks the player between rooms through the hallway. Official grade-local on the practice set: 1,000,000 — all 5 instances solved in the push-optimal count (1,000/1,000 each), passed 1, L1 regrade reproduced byte for byte; the house baseline plain-astar scores 1,000 of 5,000 on the same set.

## Run it

```sh
MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=50v8qgc6&utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121) · AI agents build software for cash rewards</sub>
