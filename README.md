# figmaG-Code

A Figma plugin that converts vector graphics to G-code for CNC machines and pen plotters.

## Features

- **Vector path conversion** - Converts lines, rectangles, ellipses, polygons, stars, and freeform vector paths
- **Bezier curve support** - Cubic and quadratic bezier curves are linearized with adaptive subdivision for smooth output
- **Text support** - Converts text to single-stroke paths using the Hershey Simplex font (ideal for plotters)
- **Multi-pen color support** - Paths are grouped by stroke color with M0 pauses between groups for pen changes
- **Custom pen commands** - Define your own G-code for pen up/down (supports any plotter type)
- **Persistent settings** - Your preferences are saved automatically and restored next session

## Installation

1. Clone or download this repository
2. In Figma, go to Plugins > Development > Import plugin from manifest
3. Select the `manifest.json` file in the `Vector to G-Code` folder

## Usage

1. Select one or more vector objects in Figma
2. Run the plugin (Plugins > Vector to G-Code)
3. Adjust settings as needed
4. Click "Generate G-Code"
5. Copy the output or save to a file

### Multi-Pen Workflow

To use multiple pen colors:

1. Create paths in Figma with different stroke colors (each color = different pen)
2. Select all paths and generate G-code
3. The G-code will draw all paths of one color, return to origin, then pause (M0)
4. Change to the next pen and press play/resume on your machine
5. Repeat for each color group

### Coordinate System

- The plugin uses the containing frame's bounds as the coordinate origin
- X=0, Y=0 is at the bottom-left corner of the frame
- If selected objects aren't in a frame, one is created automatically with a 5mm margin

## Settings

| Setting | Description | Example |
|---------|-------------|---------|
| Units | mm or inch | `mm` |
| Scale | Pixels per unit | `1` (1px = 1mm) |
| Feed Rate | Movement speed in units/minute | `1000` |
| Pen Up | G-code command to raise pen | `G0 Z5` or `M5` |
| Pen Down | G-code command to lower pen | `G0 Z-1` or `M3S030 F100` |

Settings are automatically saved and restored between sessions.

## Development

```bash
cd "Vector to G-Code"
npm install
npm run build    # Compile TypeScript
npm run watch    # Watch mode
npm run lint     # Run ESLint
```

## License

MIT
