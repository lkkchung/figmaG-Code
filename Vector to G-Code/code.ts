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

  // Generate G-code
  const gcode = pathsToGCode(allPaths, settings);

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

      case 'C': // Cubic bezier - for Phase 1, just use the endpoint
        // Full bezier support will come in Phase 2
        if (args.length >= 6) {
          // args: x1, y1, x2, y2, x, y (control points then endpoint)
          currentX = args[4];
          currentY = args[5];
          const abs = transformPoint(currentX, currentY, transform);
          points.push(abs);
        }
        break;

      case 'Q': // Quadratic bezier - use endpoint
        if (args.length >= 4) {
          currentX = args[2];
          currentY = args[3];
          const abs = transformPoint(currentX, currentY, transform);
          points.push(abs);
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

function pathsToGCode(paths: Path[], settings: Settings): string {
  const lines: string[] = [];
  const { units, scale, feedRate, penUp, penDown } = settings;

  // Header
  lines.push('; Generated by Figma Vector to G-Code');
  lines.push(`; Units: ${units}`);
  lines.push(`; Paths: ${paths.length}`);
  lines.push('');
  lines.push(units === 'mm' ? 'G21' : 'G20'); // Set units
  lines.push('G90'); // Absolute positioning
  lines.push('G17'); // XY plane
  lines.push('');

  // Find bounding box to flip Y axis (Figma Y goes down, G-code Y goes up)
  let minY = Infinity, maxY = -Infinity;
  for (const path of paths) {
    for (const point of path.points) {
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
  }
  const yFlipOffset = minY + maxY; // Used to flip Y: newY = yFlipOffset - oldY

  // Initial pen up
  lines.push(`G0 Z${penUp}`);

  // Process each path
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    if (path.points.length === 0) continue;

    lines.push('');
    lines.push(`; Path ${i + 1}`);

    // Move to start (pen up)
    const start = path.points[0];
    const startX = (start.x / scale).toFixed(3);
    const startY = ((yFlipOffset - start.y) / scale).toFixed(3);
    lines.push(`G0 X${startX} Y${startY}`);

    // Pen down
    lines.push(`G0 Z${penDown}`);

    // Draw path
    for (let j = 1; j < path.points.length; j++) {
      const point = path.points[j];
      const x = (point.x / scale).toFixed(3);
      const y = ((yFlipOffset - point.y) / scale).toFixed(3);
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
