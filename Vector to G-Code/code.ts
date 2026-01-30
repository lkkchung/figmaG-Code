// Vector to G-Code Plugin
// Converts Figma vector paths to GRBL-compatible G-code for pen plotters

interface Settings {
  units: 'mm' | 'inch';
  scale: number;      // pixels per unit
  feedRate: number;   // units per minute
  penUpCmd: string;   // G-code command to raise pen
  penDownCmd: string; // G-code command to lower pen
}

interface Point {
  x: number;
  y: number;
}

interface StrokeColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface Path {
  points: Point[];
  closed: boolean;
  color?: StrokeColor;  // Stroke color for multi-pen support
}

interface Origin {
  x: number;
  y: number;
  height: number;  // frame height for Y flip
  frame: FrameNode | null;  // null if we created a new frame
}

// Tolerance for bezier curve linearization (in pixels)
// Smaller = more accurate but more points
const BEZIER_TOLERANCE = 0.5;

// Hershey Simplex font for single-stroke text
// Each character has width and strokes (arrays of [x,y] coordinate pairs)
// Coordinates are in a 21-unit grid, baseline at y=9
interface HersheyGlyph {
  width: number;
  strokes: number[][];  // Each stroke is [x1,y1,x2,y2,...]
}

const HERSHEY_FONT: { [char: string]: HersheyGlyph } = {
  ' ': { width: 16, strokes: [] },
  '!': { width: 10, strokes: [[5,2,5,14],[5,19,4,20,5,21,6,20,5,19]] },
  '"': { width: 16, strokes: [[4,2,4,9],[12,2,12,9]] },
  '#': { width: 21, strokes: [[11,4,4,25],[17,4,10,25],[4,12,18,12],[3,18,17,18]] },
  '$': { width: 20, strokes: [[8,1,8,26],[12,1,12,26],[17,6,15,4,12,3,8,3,5,4,3,6,3,8,4,10,5,11,7,12,13,14,15,15,16,16,17,18,17,20,15,22,12,23,8,23,5,22,3,20]] },
  '%': { width: 24, strokes: [[21,2,3,23],[8,2,10,4,10,6,9,8,7,9,5,9,3,7,3,5,4,3,6,2,8,2,10,3,13,4,16,4,19,3,21,2],[17,16,15,17,14,19,14,21,16,23,18,23,20,22,21,20,21,18,19,16,17,16]] },
  '&': { width: 26, strokes: [[23,9,23,10,22,11,21,11,20,10,19,8,17,4,15,2,13,1,10,1,7,2,5,4,4,6,4,8,5,10,14,19,15,21,15,23,14,24,12,24,10,22,7,16,5,13,3,11,1,10,0,10]] },
  '\'': { width: 10, strokes: [[5,3,4,2,5,1,6,2,6,4,5,6,4,7]] },
  '(': { width: 14, strokes: [[11,1,9,3,7,6,5,10,4,15,4,19,5,23,7,26,9,28,11,30]] },
  ')': { width: 14, strokes: [[3,1,5,3,7,6,9,10,10,15,10,19,9,23,7,26,5,28,3,30]] },
  '*': { width: 16, strokes: [[8,7,8,19],[3,10,13,16],[13,10,3,16]] },
  '+': { width: 26, strokes: [[13,4,13,22],[4,13,22,13]] },
  ',': { width: 10, strokes: [[6,18,5,19,4,18,5,17,6,18,6,20,5,22,4,23]] },
  '-': { width: 26, strokes: [[4,13,22,13]] },
  '.': { width: 10, strokes: [[5,18,4,19,5,20,6,19,5,18]] },
  '/': { width: 22, strokes: [[20,1,2,30]] },
  '0': { width: 20, strokes: [[9,2,6,3,4,6,3,10,3,15,4,19,6,22,9,23,11,23,14,22,16,19,17,15,17,10,16,6,14,3,11,2,9,2]] },
  '1': { width: 20, strokes: [[6,6,8,5,11,2,11,23]] },
  '2': { width: 20, strokes: [[4,7,4,6,5,4,6,3,8,2,12,2,14,3,15,4,16,6,16,8,15,10,13,13,3,23,17,23]] },
  '3': { width: 20, strokes: [[5,2,16,2,10,11,13,11,15,12,16,13,17,16,17,17,16,20,14,22,11,23,8,23,5,22,4,21,3,19]] },
  '4': { width: 20, strokes: [[13,2,3,15,18,15],[13,2,13,23]] },
  '5': { width: 20, strokes: [[15,2,5,2,4,11,5,10,8,9,11,9,14,10,16,12,17,15,17,17,16,20,14,22,11,23,8,23,5,22,4,21,3,19]] },
  '6': { width: 20, strokes: [[16,5,15,3,12,2,10,2,7,3,5,6,4,10,4,15,5,19,7,22,10,23,11,23,14,22,16,20,17,17,17,16,16,13,14,11,11,10,10,10,7,11,5,13,4,15]] },
  '7': { width: 20, strokes: [[17,2,7,23],[3,2,17,2]] },
  '8': { width: 20, strokes: [[8,2,5,3,4,5,4,7,5,9,7,11,11,13,14,15,16,17,17,19,17,21,16,22,14,23,6,23,4,22,3,21,3,19,4,17,6,15,9,13,13,11,15,9,16,7,16,5,15,3,12,2,8,2]] },
  '9': { width: 20, strokes: [[16,10,15,13,13,15,10,16,9,16,6,15,4,13,3,10,3,9,4,6,6,4,9,2,10,2,13,3,15,5,16,10,16,15,15,20,13,22,10,23,8,23,5,22,4,20]] },
  ':': { width: 10, strokes: [[5,8,4,9,5,10,6,9,5,8],[5,18,4,19,5,20,6,19,5,18]] },
  ';': { width: 10, strokes: [[5,8,4,9,5,10,6,9,5,8],[6,18,5,19,4,18,5,17,6,18,6,20,5,22,4,23]] },
  '<': { width: 24, strokes: [[20,4,4,13,20,22]] },
  '=': { width: 26, strokes: [[4,10,22,10],[4,16,22,16]] },
  '>': { width: 24, strokes: [[4,4,20,13,4,22]] },
  '?': { width: 18, strokes: [[3,6,3,5,4,3,5,2,8,1,11,1,14,2,15,3,16,5,16,7,15,9,14,10,9,12,9,15],[9,19,8,20,9,21,10,20,9,19]] },
  '@': { width: 27, strokes: [[18,9,17,7,15,6,12,6,10,7,9,8,8,11,8,14,9,16,11,17,14,17,16,16,17,14],[12,6,10,8,9,11,9,14,10,16,11,17],[18,6,17,14,17,16,19,17,21,17,23,15,24,12,24,10,23,7,22,5,20,3,18,2,15,1,12,1,9,2,7,3,5,5,4,7,3,10,3,13,4,16,5,18,7,20,9,21,12,22,15,22,18,21,20,20,21,19],[17,6,18,14,18,16,19,17]] },
  'A': { width: 18, strokes: [[9,2,1,23],[9,2,17,23],[4,16,14,16]] },
  'B': { width: 21, strokes: [[4,2,4,23],[4,2,13,2,16,3,17,4,18,6,18,8,17,10,16,11,13,12],[4,12,13,12,16,13,17,14,18,16,18,19,17,21,16,22,13,23,4,23]] },
  'C': { width: 21, strokes: [[18,7,17,4,15,2,12,1,9,1,6,2,4,4,3,7,3,18,4,21,6,23,9,24,12,24,15,23,17,21,18,18]] },
  'D': { width: 21, strokes: [[4,2,4,23],[4,2,11,2,14,3,16,5,17,7,18,10,18,15,17,18,16,20,14,22,11,23,4,23]] },
  'E': { width: 19, strokes: [[4,2,4,23],[4,2,17,2],[4,12,12,12],[4,23,17,23]] },
  'F': { width: 18, strokes: [[4,2,4,23],[4,2,17,2],[4,12,12,12]] },
  'G': { width: 21, strokes: [[18,7,17,4,15,2,12,1,9,1,6,2,4,4,3,7,3,18,4,21,6,23,9,24,12,24,15,23,17,21,18,18,18,12,12,12]] },
  'H': { width: 22, strokes: [[4,2,4,23],[18,2,18,23],[4,12,18,12]] },
  'I': { width: 8, strokes: [[4,2,4,23]] },
  'J': { width: 16, strokes: [[12,2,12,18,11,21,10,22,8,23,6,23,4,22,3,21,2,18,2,16]] },
  'K': { width: 21, strokes: [[4,2,4,23],[18,2,4,15],[9,10,18,23]] },
  'L': { width: 17, strokes: [[4,2,4,23],[4,23,16,23]] },
  'M': { width: 24, strokes: [[4,2,4,23],[4,2,12,23],[20,2,12,23],[20,2,20,23]] },
  'N': { width: 22, strokes: [[4,2,4,23],[4,2,18,23],[18,2,18,23]] },
  'O': { width: 22, strokes: [[9,1,6,2,4,4,3,7,3,18,4,21,6,23,9,24,13,24,16,23,18,21,19,18,19,7,18,4,16,2,13,1,9,1]] },
  'P': { width: 21, strokes: [[4,2,4,23],[4,2,13,2,16,3,17,4,18,6,18,9,17,11,16,12,13,13,4,13]] },
  'Q': { width: 22, strokes: [[9,1,6,2,4,4,3,7,3,18,4,21,6,23,9,24,13,24,16,23,18,21,19,18,19,7,18,4,16,2,13,1,9,1],[13,19,18,24]] },
  'R': { width: 21, strokes: [[4,2,4,23],[4,2,13,2,16,3,17,4,18,6,18,8,17,10,16,11,13,12,4,12],[11,12,18,23]] },
  'S': { width: 20, strokes: [[17,5,15,3,12,2,8,2,5,3,3,5,3,7,4,9,5,10,7,11,13,13,15,14,16,15,17,17,17,20,15,22,12,23,8,23,5,22,3,20]] },
  'T': { width: 16, strokes: [[8,2,8,23],[1,2,15,2]] },
  'U': { width: 22, strokes: [[4,2,4,17,5,20,7,22,10,23,12,23,15,22,17,20,18,17,18,2]] },
  'V': { width: 18, strokes: [[1,2,9,23],[17,2,9,23]] },
  'W': { width: 24, strokes: [[2,2,6,23],[10,2,6,23],[10,2,14,23],[18,2,14,23]] },
  'X': { width: 20, strokes: [[3,2,17,23],[17,2,3,23]] },
  'Y': { width: 18, strokes: [[1,2,9,13,9,23],[17,2,9,13]] },
  'Z': { width: 20, strokes: [[17,2,3,23],[3,2,17,2],[3,23,17,23]] },
  '[': { width: 14, strokes: [[4,1,4,30],[5,1,5,30],[4,1,11,1],[4,30,11,30]] },
  '\\': { width: 14, strokes: [[0,1,14,30]] },
  ']': { width: 14, strokes: [[9,1,9,30],[10,1,10,30],[3,1,10,1],[3,30,10,30]] },
  '^': { width: 16, strokes: [[8,4,0,18],[8,4,16,18]] },
  '_': { width: 18, strokes: [[0,30,18,30]] },
  '`': { width: 10, strokes: [[6,1,5,2,4,1,5,0,6,1,6,3,5,5,4,6]] },
  'a': { width: 19, strokes: [[15,8,15,23],[15,11,13,9,11,8,8,8,5,9,3,11,2,14,2,17,3,20,5,22,8,23,11,23,13,22,15,20]] },
  'b': { width: 19, strokes: [[4,2,4,23],[4,11,6,9,8,8,11,8,14,9,16,11,17,14,17,17,16,20,14,22,11,23,8,23,6,22,4,20]] },
  'c': { width: 18, strokes: [[17,11,15,9,13,8,10,8,7,9,5,11,4,14,4,17,5,20,7,22,10,23,13,23,15,22,17,20]] },
  'd': { width: 19, strokes: [[15,2,15,23],[15,11,13,9,11,8,8,8,5,9,3,11,2,14,2,17,3,20,5,22,8,23,11,23,13,22,15,20]] },
  'e': { width: 18, strokes: [[4,15,17,15,17,13,16,10,15,9,13,8,10,8,7,9,5,11,4,14,4,17,5,20,7,22,10,23,13,23,15,22,17,20]] },
  'f': { width: 12, strokes: [[10,2,8,2,6,3,5,6,5,23],[2,9,9,9]] },
  'g': { width: 19, strokes: [[15,8,15,27,14,30,13,31,10,32,8,32],[15,11,13,9,11,8,8,8,5,9,3,11,2,14,2,17,3,20,5,22,8,23,11,23,13,22,15,20]] },
  'h': { width: 19, strokes: [[4,2,4,23],[4,12,7,9,9,8,12,8,15,9,16,12,16,23]] },
  'i': { width: 8, strokes: [[3,2,4,3,5,2,4,1,3,2],[4,8,4,23]] },
  'j': { width: 10, strokes: [[5,2,6,3,7,2,6,1,5,2],[6,8,6,27,5,30,3,31,1,31]] },
  'k': { width: 17, strokes: [[4,2,4,23],[14,8,4,18],[8,14,15,23]] },
  'l': { width: 8, strokes: [[4,2,4,23]] },
  'm': { width: 30, strokes: [[4,8,4,23],[4,12,7,9,9,8,12,8,15,9,16,12,16,23],[16,12,19,9,21,8,24,8,27,9,28,12,28,23]] },
  'n': { width: 19, strokes: [[4,8,4,23],[4,12,7,9,9,8,12,8,15,9,16,12,16,23]] },
  'o': { width: 19, strokes: [[10,8,7,9,5,11,4,14,4,17,5,20,7,22,10,23,12,23,15,22,17,20,18,17,18,14,17,11,15,9,12,8,10,8]] },
  'p': { width: 19, strokes: [[4,8,4,32],[4,11,6,9,8,8,11,8,14,9,16,11,17,14,17,17,16,20,14,22,11,23,8,23,6,22,4,20]] },
  'q': { width: 19, strokes: [[15,8,15,32],[15,11,13,9,11,8,8,8,5,9,3,11,2,14,2,17,3,20,5,22,8,23,11,23,13,22,15,20]] },
  'r': { width: 13, strokes: [[4,8,4,23],[4,14,5,11,7,9,9,8,12,8]] },
  's': { width: 17, strokes: [[15,10,14,9,11,8,7,8,4,9,3,11,4,13,7,14,11,15,14,16,15,18,15,20,14,22,11,23,7,23,4,22,3,21]] },
  't': { width: 12, strokes: [[5,2,5,19,6,22,8,23,10,23],[2,8,9,8]] },
  'u': { width: 19, strokes: [[4,8,4,19,5,22,8,23,11,23,13,22,15,19],[15,8,15,23]] },
  'v': { width: 16, strokes: [[2,8,8,23],[14,8,8,23]] },
  'w': { width: 22, strokes: [[3,8,6,23],[9,8,6,23],[9,8,12,23],[15,8,12,23]] },
  'x': { width: 17, strokes: [[3,8,14,23],[14,8,3,23]] },
  'y': { width: 16, strokes: [[2,8,8,23],[14,8,8,23,6,27,4,30,2,31,1,31]] },
  'z': { width: 17, strokes: [[14,8,3,23],[3,8,14,8],[3,23,14,23]] },
  '{': { width: 14, strokes: [[9,1,7,2,6,3,5,5,5,7,6,9,7,10,8,12,8,14,6,16],[7,2,6,4,6,6,7,8,8,9,9,11,9,13,8,15,4,17,8,19,9,21,9,23,8,25,7,26,6,28,6,30,7,32],[6,18,8,20,8,22,7,24,6,25,5,27,5,29,6,31,7,32,9,33]] },
  '|': { width: 8, strokes: [[4,1,4,33]] },
  '}': { width: 14, strokes: [[5,1,7,2,8,3,9,5,9,7,8,9,7,10,6,12,6,14,8,16],[7,2,8,4,8,6,7,8,6,9,5,11,5,13,6,15,10,17,6,19,5,21,5,23,6,25,7,26,8,28,8,30,7,32],[8,18,6,20,6,22,7,24,8,25,9,27,9,29,8,31,7,32,5,33]] },
  '~': { width: 24, strokes: [[3,16,3,14,4,11,6,10,8,10,10,11,14,14,16,15,18,15,20,14,21,12],[21,16,21,12,20,9,18,8,16,8,14,9,10,12,8,13,6,13,4,12,3,10]] },
};

// Get stroke color from a node
function getNodeStrokeColor(node: SceneNode): StrokeColor | undefined {
  if ('strokes' in node && node.strokes && node.strokes.length > 0) {
    const stroke = node.strokes[0];
    if (stroke.type === 'SOLID') {
      return {
        r: stroke.color.r,
        g: stroke.color.g,
        b: stroke.color.b,
        a: stroke.opacity !== undefined ? stroke.opacity : 1
      };
    }
  }
  return undefined;
}

// Convert StrokeColor to hex string for grouping
function colorToHex(color: StrokeColor): string {
  const toHex = (n: number) => {
    const hex = Math.round(n * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`.toUpperCase();
}

// Group paths by their stroke color
function groupPathsByColor(paths: Path[]): Map<string, Path[]> {
  const groups = new Map<string, Path[]>();

  for (const path of paths) {
    const key = path.color ? colorToHex(path.color) : 'DEFAULT';
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(path);
  }

  return groups;
}

// Show UI with larger size for the output textarea
figma.showUI(__html__, { width: 300, height: 480 });

// Load saved settings on startup
(async () => {
  const saved = await figma.clientStorage.getAsync('settings');
  if (saved) {
    figma.ui.postMessage({ type: 'loadSettings', settings: saved });
  }
})();

figma.ui.onmessage = async (msg: { type: string; settings?: Settings }) => {
  if (msg.type === 'generate') {
    // Save settings for next time
    await figma.clientStorage.setAsync('settings', msg.settings);
    generateGCode(msg.settings!);
  } else if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};

// Collect all TextNodes from a node tree
function collectTextNodes(node: SceneNode): TextNode[] {
  const textNodes: TextNode[] = [];
  if (node.type === 'TEXT') {
    textNodes.push(node as TextNode);
  } else if ('children' in node) {
    for (const child of (node as FrameNode | GroupNode).children) {
      textNodes.push(...collectTextNodes(child));
    }
  }
  return textNodes;
}

async function generateGCode(settings: Settings): Promise<void> {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.ui.postMessage({ type: 'error', message: 'Please select one or more vector objects' });
    return;
  }

  // Determine origin: use containing frame or create one
  const origin = determineOrigin(selection, settings);

  // Extract paths from all selected nodes (non-text)
  const allPaths: Path[] = [];

  for (const node of selection) {
    const paths = extractPaths(node);
    allPaths.push(...paths);
  }

  // Collect and process text nodes (requires async font loading)
  const textNodes: TextNode[] = [];
  for (const node of selection) {
    textNodes.push(...collectTextNodes(node));
  }

  // Load fonts and convert text nodes
  for (const textNode of textNodes) {
    try {
      // Load all fonts used in the text node
      const fontName = textNode.fontName;
      if (fontName !== figma.mixed) {
        await figma.loadFontAsync(fontName);
      } else {
        // Mixed fonts - load each segment's font
        const len = textNode.characters.length;
        for (let i = 0; i < len; i++) {
          const font = textNode.getRangeFontName(i, i + 1) as FontName;
          await figma.loadFontAsync(font);
        }
      }

      // Now convert to Hershey paths
      const textPaths = textNodeToPaths(textNode);
      allPaths.push(...textPaths);
    } catch (e) {
      console.error('Failed to load font for text node:', e);
    }
  }

  if (allPaths.length === 0) {
    figma.ui.postMessage({ type: 'error', message: 'No vector paths found in selection' });
    return;
  }

  // Generate G-code with origin offset
  const gcode = pathsToGCode(allPaths, settings, origin);

  // Count total lines (excluding comments and empty lines)
  const lineCount = gcode.split('\n').filter(line =>
    line.trim() && !line.startsWith(';')
  ).length;

  figma.ui.postMessage({
    type: 'gcode',
    gcode: gcode,
    pathCount: allPaths.length,
    lineCount: lineCount
  });
}

function determineOrigin(selection: readonly SceneNode[], settings: Settings): Origin {
  // Check if a single frame is selected - use it directly as bounds
  if (selection.length === 1 && selection[0].type === 'FRAME') {
    const frame = selection[0] as FrameNode;
    return {
      x: frame.absoluteTransform[0][2],
      y: frame.absoluteTransform[1][2],
      height: frame.height,
      frame: frame
    };
  }

  // Check if all selected nodes share a common parent frame
  const firstParent = selection[0].parent;

  if (firstParent && firstParent.type === 'FRAME') {
    // Check if all nodes are in the same frame
    const allInSameFrame = selection.every(node => node.parent === firstParent);

    if (allInSameFrame) {
      // Use the frame's top-left corner as origin
      const frame = firstParent as FrameNode;
      return {
        x: frame.absoluteTransform[0][2],
        y: frame.absoluteTransform[1][2],
        height: frame.height,
        frame: frame
      };
    }
  }

  // No common frame - calculate bounds and create a new frame with 5mm margin
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const node of selection) {
    if ('absoluteBoundingBox' in node && node.absoluteBoundingBox) {
      const bounds = node.absoluteBoundingBox;
      minX = Math.min(minX, bounds.x);
      minY = Math.min(minY, bounds.y);
      maxX = Math.max(maxX, bounds.x + bounds.width);
      maxY = Math.max(maxY, bounds.y + bounds.height);
    }
  }

  // Convert 5mm margin to pixels (using scale setting)
  const marginPx = 5 * settings.scale;

  // Create a new frame around the selection with margin
  const frame = figma.createFrame();
  frame.name = 'G-Code Bounds';
  frame.x = minX - marginPx;
  frame.y = minY - marginPx;
  frame.resize(maxX - minX + marginPx * 2, maxY - minY + marginPx * 2);
  frame.fills = []; // Transparent
  frame.strokes = [{ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 1 }, opacity: 0.5 }];
  frame.strokeWeight = 1;

  // Move selected objects into the frame
  for (const node of selection) {
    // Store absolute position before moving
    const absX = node.absoluteTransform[0][2];
    const absY = node.absoluteTransform[1][2];

    // Move node into frame
    frame.appendChild(node);

    // Reposition to maintain visual location (now relative to frame)
    if ('x' in node && 'y' in node) {
      (node as SceneNode & { x: number; y: number }).x = absX - frame.x;
      (node as SceneNode & { x: number; y: number }).y = absY - frame.y;
    }
  }

  return {
    x: frame.absoluteTransform[0][2],
    y: frame.absoluteTransform[1][2],
    height: frame.height,
    frame: null  // null indicates we created a new frame
  };
}

function extractPaths(node: SceneNode): Path[] {
  const paths: Path[] = [];
  const color = getNodeStrokeColor(node);

  // Handle different node types
  if ('vectorPaths' in node && node.vectorPaths) {
    // VectorNode or similar with vectorPaths property
    const vectorNode = node as VectorNode;
    for (const vectorPath of vectorNode.vectorPaths) {
      const path = parsePathData(vectorPath.data, node);
      if (path.points.length > 0) {
        path.color = color;
        paths.push(path);
      }
    }
  } else if (node.type === 'RECTANGLE') {
    // Convert rectangle to path
    const rect = node as RectangleNode;
    const path = rectangleToPath(rect);
    path.color = color;
    paths.push(path);
  } else if (node.type === 'ELLIPSE') {
    // Convert ellipse to path (approximate with line segments)
    const ellipse = node as EllipseNode;
    const path = ellipseToPath(ellipse);
    path.color = color;
    paths.push(path);
  } else if (node.type === 'POLYGON' || node.type === 'STAR') {
    // These have vectorPaths, handled above
  } else if (node.type === 'LINE') {
    const line = node as LineNode;
    const path = lineToPath(line);
    path.color = color;
    paths.push(path);
  } else if (node.type === 'TEXT') {
    // Text nodes are handled separately in extractPathsAsync
    // Skip here - they'll be processed with font loading
  } else if (node.type === 'FRAME' || node.type === 'GROUP') {
    // Recurse into children
    const container = node as FrameNode | GroupNode;
    for (const child of container.children) {
      paths.push(...extractPaths(child));
    }
  }

  return paths;
}

function parsePathData(data: string, node: SceneNode): Path {
  const points: Point[] = [];
  let closed = false;

  // Get the node's absolute transform to convert local coords to absolute
  const transform = node.absoluteTransform;

  // Parse SVG-like path commands: M, L, C, Z
  // Split by command letters while keeping them
  const commands = data.match(/[MLCQZ][^MLCQZ]*/gi) || [];

  let currentX = 0;
  let currentY = 0;

  for (const cmd of commands) {
    const type = cmd[0].toUpperCase();
    const args = cmd.slice(1).trim().split(/[\s,]+/).filter(s => s).map(parseFloat);

    switch (type) {
      case 'M': // Move to
        if (args.length >= 2) {
          currentX = args[0];
          currentY = args[1];
          const abs = transformPoint(currentX, currentY, transform);
          points.push(abs);
        }
        break;

      case 'L': // Line to
        if (args.length >= 2) {
          currentX = args[0];
          currentY = args[1];
          const abs = transformPoint(currentX, currentY, transform);
          points.push(abs);
        }
        break;

      case 'C': // Cubic bezier - linearize with adaptive subdivision
        if (args.length >= 6) {
          // args: x1, y1, x2, y2, x, y (control points then endpoint)
          const p0 = transformPoint(currentX, currentY, transform);
          const p1 = transformPoint(args[0], args[1], transform);
          const p2 = transformPoint(args[2], args[3], transform);
          const p3 = transformPoint(args[4], args[5], transform);

          // Linearize and add all points
          const bezierPoints = linearizeCubicBezier(p0, p1, p2, p3);
          points.push(...bezierPoints);

          currentX = args[4];
          currentY = args[5];
        }
        break;

      case 'Q': // Quadratic bezier - linearize with adaptive subdivision
        if (args.length >= 4) {
          const p0 = transformPoint(currentX, currentY, transform);
          const p1 = transformPoint(args[0], args[1], transform);
          const p2 = transformPoint(args[2], args[3], transform);

          // Linearize and add all points
          const bezierPoints = linearizeQuadraticBezier(p0, p1, p2);
          points.push(...bezierPoints);

          currentX = args[2];
          currentY = args[3];
        }
        break;

      case 'Z': // Close path
        closed = true;
        // Add first point again if needed for closed path
        if (points.length > 0 &&
            (points[points.length - 1].x !== points[0].x ||
             points[points.length - 1].y !== points[0].y)) {
          points.push({ ...points[0] });
        }
        break;
    }
  }

  return { points, closed };
}

function transformPoint(x: number, y: number, transform: Transform): Point {
  // Apply 2D affine transform
  // transform is [[a, c, e], [b, d, f]] representing:
  // newX = a*x + c*y + e
  // newY = b*x + d*y + f
  return {
    x: transform[0][0] * x + transform[0][1] * y + transform[0][2],
    y: transform[1][0] * x + transform[1][1] * y + transform[1][2]
  };
}

// Linearize a cubic bezier curve using adaptive subdivision
// p0 = start, p1 = control1, p2 = control2, p3 = end
// Returns array of points (excluding p0, which is already in the path)
function linearizeCubicBezier(
  p0: Point, p1: Point, p2: Point, p3: Point,
  tolerance: number = BEZIER_TOLERANCE
): Point[] {
  const points: Point[] = [];

  // Check if curve is flat enough using distance from control points to chord
  const flatness = cubicBezierFlatness(p0, p1, p2, p3);

  if (flatness <= tolerance) {
    // Flat enough - just add the endpoint
    points.push(p3);
  } else {
    // Subdivide using de Casteljau's algorithm at t=0.5
    const mid01 = midpoint(p0, p1);
    const mid12 = midpoint(p1, p2);
    const mid23 = midpoint(p2, p3);
    const mid012 = midpoint(mid01, mid12);
    const mid123 = midpoint(mid12, mid23);
    const mid0123 = midpoint(mid012, mid123);

    // Recurse on both halves
    points.push(...linearizeCubicBezier(p0, mid01, mid012, mid0123, tolerance));
    points.push(...linearizeCubicBezier(mid0123, mid123, mid23, p3, tolerance));
  }

  return points;
}

// Linearize a quadratic bezier by converting to cubic
// p0 = start, p1 = control, p2 = end
function linearizeQuadraticBezier(
  p0: Point, p1: Point, p2: Point,
  tolerance: number = BEZIER_TOLERANCE
): Point[] {
  // Convert quadratic to cubic: cubic control points are at 2/3 along quad control
  const cp1: Point = {
    x: p0.x + (2/3) * (p1.x - p0.x),
    y: p0.y + (2/3) * (p1.y - p0.y)
  };
  const cp2: Point = {
    x: p2.x + (2/3) * (p1.x - p2.x),
    y: p2.y + (2/3) * (p1.y - p2.y)
  };
  return linearizeCubicBezier(p0, cp1, cp2, p2, tolerance);
}

// Calculate flatness of cubic bezier (max distance from control points to chord)
function cubicBezierFlatness(p0: Point, p1: Point, p2: Point, p3: Point): number {
  // Use simplified flatness test: max perpendicular distance of control points to chord
  const d1 = pointToLineDistance(p1, p0, p3);
  const d2 = pointToLineDistance(p2, p0, p3);
  return Math.max(d1, d2);
}

// Distance from point p to line defined by points a and b
function pointToLineDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    // a and b are the same point
    return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
  }

  // Perpendicular distance using cross product
  const cross = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx);
  return cross / Math.sqrt(lengthSq);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// Calculate Hershey text dimensions without creating paths
function measureHersheyText(text: string): { width: number; height: number } {
  const lines = text.split('\n');
  let maxWidth = 0;

  for (const line of lines) {
    let lineWidth = 0;
    for (const char of line) {
      const glyph = HERSHEY_FONT[char];
      lineWidth += glyph ? glyph.width : (HERSHEY_FONT[' ']?.width || 16);
    }
    maxWidth = Math.max(maxWidth, lineWidth);
  }

  // Hershey font: characters are roughly 21 units tall, line spacing ~25 units
  const lineHeight = 25;
  const height = lines.length * lineHeight;

  return { width: maxWidth, height };
}

// Convert a TextNode to single-stroke paths using Hershey font
// Scales output to match the TextNode's actual dimensions
function textNodeToPaths(node: TextNode): Path[] {
  const paths: Path[] = [];
  const text = node.characters;

  if (!text) return paths;

  // Get stroke color from the text node
  const color = getNodeStrokeColor(node);

  // Set text to auto-width and cap-height baseline for accurate sizing
  node.textAutoResize = 'WIDTH_AND_HEIGHT';
  if ('leadingTrim' in node) {
    (node as any).leadingTrim = 'CAP_HEIGHT';
  }

  // Get TextNode's actual dimensions (after auto-resize)
  const targetWidth = node.width;
  const targetHeight = node.height;

  // Measure Hershey text in its native units
  const hersheySize = measureHersheyText(text);

  if (hersheySize.width === 0 || hersheySize.height === 0) return paths;

  // Calculate scale to fit Hershey text to TextNode dimensions
  const scaleX = targetWidth / hersheySize.width;
  const scaleY = targetHeight / hersheySize.height;

  // Get the full transform (includes rotation)
  const transform = node.absoluteTransform;

  // Process each line of text
  const lines = text.split('\n');
  const lineHeight = 25; // Hershey native line height
  let lineIndex = 0;

  for (const line of lines) {
    let cursorX = 0; // In Hershey units

    for (const char of line) {
      const glyph = HERSHEY_FONT[char];
      if (!glyph) {
        cursorX += HERSHEY_FONT[' ']?.width || 16;
        continue;
      }

      // Each stroke in the glyph becomes a separate path
      for (const stroke of glyph.strokes) {
        if (stroke.length < 4) continue;

        const points: Point[] = [];
        for (let i = 0; i < stroke.length; i += 2) {
          // Calculate local position (scaled to match TextNode size)
          const localX = (cursorX + stroke[i]) * scaleX;
          const localY = (lineIndex * lineHeight + stroke[i + 1]) * scaleY;

          // Apply full transform (rotation, scale, translation)
          points.push(transformPoint(localX, localY, transform));
        }

        if (points.length >= 2) {
          paths.push({ points, closed: false, color });
        }
      }

      cursorX += glyph.width;
    }

    lineIndex++;
  }

  return paths;
}

function rectangleToPath(rect: RectangleNode): Path {
  const transform = rect.absoluteTransform;
  const w = rect.width;
  const h = rect.height;

  // Rectangle corners in local coordinates
  const corners = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
    { x: 0, y: 0 } // Close
  ];

  const points = corners.map(p => transformPoint(p.x, p.y, transform));
  return { points, closed: true };
}

function ellipseToPath(ellipse: EllipseNode, segments: number = 32): Path {
  const transform = ellipse.absoluteTransform;
  const rx = ellipse.width / 2;
  const ry = ellipse.height / 2;
  const cx = rx; // Center in local coords
  const cy = ry;

  const points: Point[] = [];

  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    points.push(transformPoint(x, y, transform));
  }

  return { points, closed: true };
}

function lineToPath(line: LineNode): Path {
  const transform = line.absoluteTransform;
  // Line goes from (0,0) to (width, 0) in local coordinates
  const points = [
    transformPoint(0, 0, transform),
    transformPoint(line.width, 0, transform)
  ];
  return { points, closed: false };
}

function pathsToGCode(paths: Path[], settings: Settings, origin: Origin): string {
  const lines: string[] = [];
  const { units, scale, feedRate, penUpCmd, penDownCmd } = settings;

  // Group paths by color
  const colorGroups = groupPathsByColor(paths);
  const colorKeys = Array.from(colorGroups.keys());

  // Header
  lines.push('; Generated by Figma Vector to G-Code');
  lines.push(`; Units: ${units}`);
  lines.push(`; Paths: ${paths.length}`);
  lines.push(`; Color groups: ${colorKeys.length}`);
  lines.push(`; Origin: ${origin.frame ? 'existing frame' : 'auto-generated frame'}`);
  lines.push('');
  lines.push(units === 'mm' ? 'G21' : 'G20'); // Set units
  lines.push('G90'); // Absolute positioning
  lines.push('G17'); // XY plane
  lines.push('');

  // Use frame height for Y flip (Figma Y goes down, G-code Y goes up)
  // This ensures Y=0 is at the bottom of the frame, not the bottom of paths
  const frameHeight = origin.height;

  // Initial pen up
  lines.push(penUpCmd);

  // Process each color group
  let globalPathIndex = 0;
  for (let colorIndex = 0; colorIndex < colorKeys.length; colorIndex++) {
    const colorKey = colorKeys[colorIndex];
    const groupPaths = colorGroups.get(colorKey)!;

    lines.push('');
    lines.push(`; ========================================`);
    lines.push(`; Color: ${colorKey} (${groupPaths.length} path${groupPaths.length !== 1 ? 's' : ''})`);
    lines.push(`; ========================================`);

    // Process each path in this color group
    for (const path of groupPaths) {
      if (path.points.length === 0) continue;
      globalPathIndex++;

      lines.push('');
      lines.push(`; Path ${globalPathIndex}`);

      // Move to start (pen up)
      // Subtract origin to make coordinates relative to frame
      // Flip Y: frameHeight - relY so bottom of frame becomes Y=0
      const start = path.points[0];
      const startX = ((start.x - origin.x) / scale).toFixed(3);
      const startY = ((frameHeight - (start.y - origin.y)) / scale).toFixed(3);
      lines.push(`G0 X${startX} Y${startY}`);

      // Pen down
      lines.push(penDownCmd);

      // Draw path
      for (let j = 1; j < path.points.length; j++) {
        const point = path.points[j];
        const x = ((point.x - origin.x) / scale).toFixed(3);
        const y = ((frameHeight - (point.y - origin.y)) / scale).toFixed(3);
        lines.push(`G1 X${x} Y${y} F${feedRate}`);
      }

      // Pen up after path
      lines.push(penUpCmd);
    }

    // After each color group (except the last), return to origin and pause for pen change
    if (colorIndex < colorKeys.length - 1) {
      lines.push('');
      lines.push('; Return to origin for pen change');
      lines.push(penUpCmd);
      lines.push('G0 X0 Y0');
      lines.push('M0 ; Pause - change to next pen, then resume');
    }
  }

  // Footer
  lines.push('');
  lines.push('; End');
  lines.push('G0 X0 Y0'); // Return to origin
  lines.push('M2'); // End program

  return lines.join('\n');
}
