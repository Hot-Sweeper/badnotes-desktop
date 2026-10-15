/**
 * VectorRegionFinder.js
 *
 * A tool to decompose self-intersecting vector strokes (polylines) into separate fillable regions (faces).
 * Used for "Figma-style" vector filling where a Figure-8 creates two distinct fillable areas.
 */

(function(global) {
    const EPSILON = 1e-5;

    class VectorRegionFinder {
        /**
         * Main entry point: Finds all closed regions (faces) formed by a self-intersecting plyline.
         * @param {Array<{x: number, y: number}>} points - The stroke points.
         * @returns {Array<Array<{x: number, y: number}>>} Array of polygons (each is an array of points).
         */
        static findRegions(points) {
            if (!points || points.length < 3) return [];

            // 1. Planarize: Find intersections and split segments
            const graph = this.buildPlanarGraph(points);

            // 2. Extract Faces
            const faces = this.extractFaces(graph);

            // 3. Filter valid regions (positive area, non-degenerate)
            // Note: We might get the "outer" infinite face (usually largest area, often negative depending on winding).
            // For a single stroke self-intersection, meaningful regions are usually the smaller loops.
            const validRegions = faces.filter(face => {
                const area = Math.abs(this.calculateSignedArea(face));
                return area > 100; // Filter tiny degenerate slivers (approx 10x10 px area)
            });

            return validRegions;
        }

        /**
         * Check if a point is inside a polygon using Ray Casting
         */
        static isPointInPolygon(point, polygon) {
            let inside = false;
            for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
                const xi = polygon[i].x, yi = polygon[i].y;
                const xj = polygon[j].x, yj = polygon[j].y;

                const intersect = ((yi > point.y) !== (yj > point.y)) &&
                                  (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
                if (intersect) inside = !inside;
            }
            return inside;
        }

        // --- Internal Graph Logic ---

        static buildPlanarGraph(points) {
            // Segments from the original path
            let segments = [];
            for (let i = 0; i < points.length - 1; i++) {
                segments.push({
                    p1: points[i],
                    p2: points[i+1],
                    origIndex: i
                });
            }

            // Find intersections
            // Using naive O(N^2) because strokes usually have < 1000 points.
            // For production with massive paths, a sweep-line algorithm is better.
            const cuts = new Map(); // key: segmentIndex, value: [t values]

            for (let i = 0; i < segments.length; i++) {
                for (let j = i + 2; j < segments.length; j++) {
                    // Skip adjacent segments (they share a vertex)
                    // Note: If i and j share a vertex in the array index sense, they don't intersect "internally" usually.

                    const s1 = segments[i];
                    const s2 = segments[j];

                    const intersection = this.getSegmentIntersection(s1.p1, s1.p2, s2.p1, s2.p2);

                    if (intersection) {
                        // intersection.t is ratio along s1, intersection.u is ratio along s2
                        this.addCut(cuts, i, intersection.t, intersection.point);
                        this.addCut(cuts, j, intersection.u, intersection.point);
                    }
                }
            }

            // Also check for "closing" the loop if end is near start (force snap)
            // But usually the user wants to fill distinct loops in a figure 8 even if it's open.
            // So we treat the stroke as a graph of segments.

            // Construct Graph
            // Nodes are identified by string key "x,y" to merge duplicates
            const nodes = new Map(); // key: "x,y", value: {x,y, edges: []}

            const getNode = (p) => {
                // Quantize to avoid float issues
                const key = `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
                if (!nodes.has(key)) {
                    nodes.set(key, { x: p.x, y: p.y, id: key, edges: [] });
                }
                return nodes.get(key);
            };

            const addEdge = (p1, p2) => {
                const n1 = getNode(p1);
                const n2 = getNode(p2);
                if (n1 === n2) return; // Ignore zero length edges

                // Check if edge already exists to avoid duplicates
                const exists = n1.edges.some(e => e.target === n2);
                if (!exists) {
                    const angle1 = Math.atan2(n2.y - n1.y, n2.x - n1.x);
                    const angle2 = Math.atan2(n1.y - n2.y, n1.x - n2.x);
                    n1.edges.push({ target: n2, angle: angle1 });
                    n2.edges.push({ target: n1, angle: angle2 });
                }
            };

            segments.forEach((seg, idx) => {
                let pointsOnSeg = [seg.p1, seg.p2];
                if (cuts.has(idx)) {
                    const tList = cuts.get(idx).sort((a, b) => a.t - b.t);
                    const innerPoints = tList.map(item => item.point);
                    pointsOnSeg = [seg.p1, ...innerPoints, seg.p2];
                }

                for (let k = 0; k < pointsOnSeg.length - 1; k++) {
                    addEdge(pointsOnSeg[k], pointsOnSeg[k+1]);
                }
            });

            return Array.from(nodes.values());
        }

        static addCut(cutsMap, index, t, point) {
            // Avoid endpoints (t=0 or t=1) unless careful, but here we usually take strictly internal intersections
            // or we handle them duplicates later.
            if (t > EPSILON && t < 1 - EPSILON) {
                if (!cutsMap.has(index)) cutsMap.set(index, []);
                // Check for duplicates
                const list = cutsMap.get(index);
                if (!list.some(item => Math.abs(item.t - t) < EPSILON)) {
                    list.push({ t, point });
                }
            }
        }

        static getSegmentIntersection(p1, p2, p3, p4) {
            const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
            if (Math.abs(d) < EPSILON) return null; // Parallel

            const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
            const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;

            if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
                return {
                    point: {
                        x: p1.x + t * (p2.x - p1.x),
                        y: p1.y + t * (p2.y - p1.y)
                    },
                    t: t,
                    u: u
                };
            }
            return null;
        }

        static extractFaces(nodes) {
            // 1. Sort edges at each node by angle
            nodes.forEach(node => {
                node.edges.sort((a, b) => a.angle - b.angle);
            });

            // 2. Traverse
            const faces = [];
            const visited = new Set(); // Stores "u_id|v_id" for directed edges

            nodes.forEach(startNode => {
                startNode.edges.forEach(edge => {
                    const startEdgeKey = `${startNode.id}|${edge.target.id}`;
                    if (visited.has(startEdgeKey)) return;

                    // Walk the face
                    const path = [];
                    let currNode = startNode;
                    let nextNode = edge.target;
                    let currEdgeKey = startEdgeKey;

                    // While not back to start edge
                    while (!visited.has(currEdgeKey)) {
                        visited.add(currEdgeKey);
                        path.push({ x: currNode.x, y: currNode.y });

                        // Find outgoing edge from nextNode that is "next" in CCW order after entry edge
                        // Entry edge is currNode -> nextNode.
                        // Reverse is nextNode -> currNode.
                        // We want the edge AFTER the reverse edge in nextNode's sorted list.

                        const incomingAngle = Math.atan2(currNode.y - nextNode.y, currNode.x - nextNode.x);

                        // Find insertion index
                        const edges = nextNode.edges;
                        let idx = -1;

                        // Binary search or linear scan (edges list is small)
                        // Actually, we can just look for the edge that connects back to currNode
                        // But we might have multiple edges to same node? No, simplified graph.
                        for(let i=0; i<edges.length; i++) {
                            if (edges[i].target === currNode) {
                                idx = i;
                                break;
                            }
                        }

                        // Pick next edge (idx + 1) % length
                        // Because edges are sorted by angle, this gives the sharpest left turn (or right turn depending on coord sys).
                        // In screen coords (Y down), angle increases CW?
                        // atan2(y, x):
                        // (1, 0) -> 0
                        // (0, 1) -> PI/2 (Down)
                        // (-1, 0) -> PI
                        // (0, -1) -> -PI/2 (Up)
                        // So angle increases CW.
                        // Sorting by angle means sorting CW.
                        // Taking (idx + 1) means taking the next CW edge.
                        // A face is enclosed by walking CW around its interior? Or CCW?
                        // If we walk the inside of a polygon in screen coords:
                        // To keep interior on the Right, we walk CW.
                        // Taking next CW edge usually hugs the wall on the "right".
                        // Let's try it. If we get the "hole" (outer), we filter by area.

                        if (idx === -1) break; // Should not happen
                        const nextEdgeIdx = (idx - 1 + edges.length) % edges.length; // -1 for CCW turn (Interior on Left? or Right?)
                        // If we want minimal cycles, we usually take the "hardest left" turn.
                        // If angles increase CW, "left" is identifying a DECREASE in angle.
                        // So we want the predecessor in the sorted list.

                        const nextEdgeInfo = edges[nextEdgeIdx];
                        const nextEdgeTarget = nextEdgeInfo.target;

                        currNode = nextNode;
                        nextNode = nextEdgeTarget;
                        currEdgeKey = `${currNode.id}|${nextNode.id}`;
                    }

                    if (path.length > 2) {
                        faces.push(path);
                    }
                });
            });

            return faces;
        }

        static calculateSignedArea(points) {
            let area = 0;
            for (let i = 0; i < points.length; i++) {
                const j = (i + 1) % points.length;
                area += points[i].x * points[j].y;
                area -= points[j].x * points[i].y;
            }
            return area / 2;
        }
    }

    // Expose to global scope
    global.VectorRegionFinder = VectorRegionFinder;

})(window);
