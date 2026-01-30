// Vector to G-Code Plugin
// Converts Figma vector paths to GRBL-compatible G-code for pen plotters

interface Settings {
  units: 'mm' | 'inch';
  scale: number;      // pixels per unit
  feedRate: number;   // units per minute
  penUp: number;      // Z height when pen is up
  penDown: number;    // Z height when pen is down
}

interface Point {
  x: number;
  y: number;
}

interface Path {
  points: Point[];
  closed: boolean;
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

// Show UI with larger size for the output textarea
figma.showUI(__html__, { width: 300, height: 480 });

figma.ui.onmessage = (msg: { type: string; settings?: Settings }) => {
  if (msg.type === 'generate') {
    generateGCode(msg.settings!);
  } else if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};

function generateGCode(settings: Settings): void {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.ui.postMessage({ type: 'error', message: 'Please select one or more vector objects' });
    return;
  }

  // Determine origin: use containing frame or create one
  const origin = determineOrigin(selection, settings);

  // Extract paths from all selected nodes
  const allPaths: Path[] = [];

  for (const node of selection) {
    const paths = extractPaths(node);
    allPaths.push(...paths);
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

  // Handle different node types
  if ('vectorPaths' in node && node.vectorPaths) {
    // VectorNode or similar with vectorPaths property
    const vectorNode = node as VectorNode;
    for (const vectorPath of vectorNode.vectorPaths) {
      const path = parsePathData(vectorPath.data, node);
      if (path.points.length > 0) {
        paths.push(path);
      }
    }
  } else if (node.type === 'RECTANGLE') {
    // Convert rectangle to path
    const rect = node as RectangleNode;
    const path = rectangleToPath(rect);
    paths.push(path);
  } else if (node.type === 'ELLIPSE') {
    // Convert ellipse to path (approximate with line segments)
    const ellipse = node as EllipseNode;
    const path = ellipseToPath(ellipse);
    paths.push(path);
  } else if (node.type === 'POLYGON' || node.type === 'STAR') {
    // These have vectorPaths, handled above
  } else if (node.type === 'LINE') {
    const line = node as LineNode;
    const path = lineToPath(line);
    paths.push(path);
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
  const { units, scale, feedRate, penUp, penDown } = settings;

  // Header
  lines.push('; Generated by Figma Vector to G-Code');
  lines.push(`; Units: ${units}`);
  lines.push(`; Paths: ${paths.length}`);
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
  lines.push(`G0 Z${penUp}`);

  // Process each path
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    if (path.points.length === 0) continue;

    lines.push('');
    lines.push(`; Path ${i + 1}`);

    // Move to start (pen up)
    // Subtract origin to make coordinates relative to frame
    // Flip Y: frameHeight - relY so bottom of frame becomes Y=0
    const start = path.points[0];
    const startX = ((start.x - origin.x) / scale).toFixed(3);
    const startY = ((frameHeight - (start.y - origin.y)) / scale).toFixed(3);
    lines.push(`G0 X${startX} Y${startY}`);

    // Pen down
    lines.push(`G0 Z${penDown}`);

    // Draw path
    for (let j = 1; j < path.points.length; j++) {
      const point = path.points[j];
      const x = ((point.x - origin.x) / scale).toFixed(3);
      const y = ((frameHeight - (point.y - origin.y)) / scale).toFixed(3);
      lines.push(`G1 X${x} Y${y} F${feedRate}`);
    }

    // Pen up after path
    lines.push(`G0 Z${penUp}`);
  }

  // Footer
  lines.push('');
  lines.push('; End');
  lines.push('G0 X0 Y0'); // Return to origin
  lines.push('M2'); // End program

  return lines.join('\n');
}
