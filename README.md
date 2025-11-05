# Vue Auto-Battler

A complete auto-battler game built with **Vue 3 + TypeScript + Vite + TailwindCSS**.

## Features

- **5×8 Grid Board** with drag & drop unit placement
- **A\* Pathfinding** with Manhattan heuristic
- **Two Phases**: Placement and Battle
- **Best of 3 (BO3)** match system
- **Unit Types**: Tank (melee) and Ranger (ranged)
- **Right-click Rotation** for unit facing (N→E→S→W)
- **Visual Effects**: Attack lines, particle bursts, tile flashes, HP bars
- **Range Preview** on unit hover
- **Responsive Design** (mobile-first)
- **Unit Tests** with Vitest

## Tech Stack

- **Vue 3** with Composition API
- **TypeScript** for type safety
- **Vite** for fast development
- **TailwindCSS** for styling
- **Vitest** for unit testing
- **ESLint + Prettier** for code quality

## Installation

```bash
npm install
```

## Development

Start the development server:

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Build

Build for production:

```bash
npm run build
```

Preview production build:

```bash
npm run preview
```

## Testing

Run unit tests:

```bash
npm run test
```

Run tests in watch mode:

```bash
npm run test -- --watch
```

## Gameplay

### Placement Phase

1. **Drag units** from the bench (1 Tank, 2 Rangers) onto the board
2. Units can only be placed in **rows 0-1** (bottom two rows)
3. **Right-click** on placed units to rotate their facing direction
4. Click **Start Battle** when all 3 units are placed

### Battle Phase

- Units automatically find and engage the closest enemy
- **Tank**: 18 HP, 3 ATK, 1 Range (melee)
- **Ranger**: 10 HP, 4 ATK, 2 Range (ranged, won't advance if in range)
- Movement uses **A\* pathfinding** to navigate around obstacles
- Battle continues until one team is eliminated

### Best of 3

- First team to win 2 rounds wins the match
- After each round, return to placement phase
- Match ends after 3 rounds maximum

## Controls

- **Start Battle**: Begin the battle phase (enabled when 3 units placed)
- **Shift Visual**: Rotate board rows visually (cosmetic only)
- **Reset BO3**: Reset the entire match and return to placement

## Project Structure

```
src/
├── components/          # Vue components
│   ├── Board.vue       # Game board with grid and effects
│   ├── UnitSprite.vue  # Individual unit rendering
│   ├── Bench.vue       # Unit selection bench
│   ├── Sidebar.vue     # Match info and test output
│   └── ControlsBar.vue # Game controls
├── composables/
│   └── useGame.ts      # Main game state and logic
├── logic/
│   ├── types.ts        # TypeScript type definitions
│   ├── utils.ts        # Utility functions
│   ├── pathfinding.ts  # A* pathfinding algorithm
│   ├── pathfinding.spec.ts  # Pathfinding tests
│   ├── facing.spec.ts       # Facing rotation tests
│   └── combat.spec.ts       # Combat logic tests
├── App.vue             # Root component
├── main.ts             # Application entry point
└── styles.css          # Global styles and Tailwind imports
```

## Key Implementation Details

### A\* Pathfinding

- Uses Manhattan distance heuristic
- 4-directional movement (no diagonals)
- Allows pathfinding to occupied goal cells (enemy positions)

### Ranger "Don't Go Melee" Fix

Rangers check if they're already in range before moving:

```typescript
if (manhattan(unit, target) <= unit.range) {
  return // Don't move, just attack
}
```

### Visual Effects

- **Attack Lines**: SVG lines drawn from attacker to target
- **Particle Bursts**: Animated divs at impact point
- **Tile Flash**: CSS animation on hit tiles
- **HP Bars**: Color-coded (green/yellow/red) based on HP percentage
- **Movement**: Smooth lerp animation with `requestAnimationFrame`

### Responsive Layout

- Single column on mobile (`< 768px`)
- Two columns on desktop (board + sidebar)
- Touch-friendly button sizes
- Collapsible sidebar on mobile

## Testing

The project includes comprehensive unit tests:

1. **A\* Pathfinding**
   - Path finding on empty row
   - Allowing occupied target cells
   
2. **Facing Rotation**
   - N→E→S→W→N cycle

3. **Combat Logic**
   - HP reduction on attack
   - Ranger range behavior (don't advance if in range)
   - Tank melee behavior

Run tests with `npm run test` to verify all functionality.

## License

MIT

## Credits

Built with Vue 3, TypeScript, Vite, and TailwindCSS.
