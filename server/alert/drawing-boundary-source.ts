// Purpose: Lower canonical drawing paths into ordinary Tea coordinate resolution and contact policy.
import type {
  BoundaryPoint,
  DrawingBoundary,
} from "@openchart/chart-core/drawing/boundary";

// ponytail: bound full-fidelity strokes to Tea's per-step heap budget; revisit after persistent-array updates become sublinear.
export const MAX_DRAWING_BOUNDARY_ANCHORS = 1000;

const floats = (values: readonly number[]) =>
  `array.from(${values
    .map((value) => {
      const literal = String(value);
      return Number.isInteger(value) && !/[eE]/.test(literal)
        ? `${literal}.0`
        : literal;
    })
    .join(",")})`;
const integers = (values: readonly number[]) =>
  `array.from(${values.join(",")})`;

/** Generate an inert program; geometry stays with Drawing and is never copied into a Rule.
 * Every observation resolves anchor time against its own Bars timeline. The geometry
 * library owns numerical intersections; this template owns confirmed-bar alert policy.
 * @example const source = drawingBoundarySource(boundary, anchorTimesMs);
 */
export function drawingBoundarySource(
  boundary: DrawingBoundary,
  times: readonly number[],
): string {
  const points: BoundaryPoint[] = boundary.primitives.flatMap((primitive) => [
    primitive.start,
    primitive.kind === "quadratic" ? primitive.control : primitive.start,
    primitive.end,
  ]);
  const starts = points.map(({ x }) =>
    x.kind === "anchor" ? x.index : x.from,
  );
  const ends = points.map(({ x }) => (x.kind === "anchor" ? x.index : x.to));
  const ratios = points.map(({ x }) => (x.kind === "anchor" ? 0 : x.ratio));
  return [
    "import geometry",
    'op = input.string("crossing", "Condition")',
    "type Boundary",
    "    array<int> starts",
    "    array<int> ends",
    "    array<float> ratios",
    "    array<float> prices",
    "    array<bool> quadratic",
    `var starts = ${integers(starts)}`,
    `var ends = ${integers(ends)}`,
    `var ratios = ${floats(ratios)}`,
    `var prices = ${floats(points.map((point) => point.price))}`,
    `var quadratics = array.from(${boundary.primitives.map((part) => part.kind === "quadratic").join(",")})`,
    `var boundary = Boundary.new(starts,ends,ratios,prices,quadratics)`,
    `closed = ${boundary.closed}`,
    `var anchorTimes = ${floats(times)}`,
    "type Coordinate",
    "    float value",
    `varip snapped = array.from(${Array.from({ length: times.length }, () => "Coordinate.new(na)").join(",")})`,
    `varip positions = array.from(${Array.from({ length: times.length }, () => "Coordinate.new(na)").join(",")})`,
    `varip pointXs = array.from(${Array.from({ length: points.length }, () => "Coordinate.new(na)").join(",")})`,
    `varip float geometryTime = na`,
    `varip bool geometryReady = false`,
    policy,
  ].join("\n");
}

const policy = `
pointX(Boundary b, array<Coordinate> positions, int index) =>
    a = positions.get(b.starts.get(index)).value
    z = positions.get(b.ends.get(index)).value
    return a + (z - a) * b.ratios.get(index)

pointSide(Boundary b, array<Coordinate> positions, int index, float px, float py, float qx, float qy) =>
    return geometry.orient2d(px, py, qx, qy, positions.get(index).value, b.prices.get(index))

// Resolve the adjacent branch at a vertex. Repeated points contribute no side;
// a nonzero edge lying along the observation is intentionally not skipped.
vertexSide(Boundary b, array<Coordinate> positions, int edge, bool backwards, bool closed, float px, float py, float qx, float qy) =>
    count = b.quadratic.size()
    result = 0.0
    index = edge
    for step = 0 to count - 1
        if index < 0 or index >= count
            if not closed
                break
            index := index < 0 ? count - 1 : 0
        first = index * 3
        last = first + 2
        degenerate = positions.get(first).value == positions.get(last).value and b.prices.get(first) == b.prices.get(last)
        if b.quadratic.get(index)
            degenerate := degenerate and positions.get(first).value == positions.get(first + 1).value and b.prices.get(first) == b.prices.get(first + 1)
        if not degenerate
            if b.quadratic.get(index)
                result := pointSide(b, positions, first + 1, px, py, qx, qy)
            if result == 0.0
                result := pointSide(b, positions, backwards ? first : last, px, py, qx, qy)
            break
        index := backwards ? index - 1 : index + 1
    return result

type ContactFact
    int primitiveIndex
    float observationParameter
    float time
    float price

type BoundaryOccurrence
    string observation
    float value
    array<ContactFact> contacts

// Geometry depends on bar time, not on its provisional price attempts.
if na(geometryTime) or geometryTime != time
    geometryReady := true
    for index = 0 to anchorTimes.size() - 1
        target = anchorTimes.get(index)
        actual = snapped.get(index).value
        if na(actual)
            if time == target
                actual := bar_index
            else if not na(time[1]) and time[1] < target and time > target
                actual := bar_index - 1 + (target - time[1]) / (time - time[1])
            snapped.get(index).value := actual
        projected = actual
        if na(projected) and target > time and not na(time[1]) and time > time[1]
            projected := bar_index + (target - time) / (time - time[1])
        positions.get(index).value := projected
        geometryReady := geometryReady and not na(projected) and geometry.coordinateSupported(projected)
    if geometryReady
        for index = 0 to boundary.prices.size() - 1
            pointXs.get(index).value := pointX(boundary, positions, index)
    geometryTime := time

ready = geometryReady

touching = op == "touching"
// A Touch candle occupies one ordinal slot, centred on its painted bar.
// The footprint never changes with zoom, candle body width or line thickness.
px = touching ? bar_index - 0.5 : bar_index - 1
py = touching ? low : close[1]
qx = touching ? bar_index + 0.5 : bar_index
qy = touching ? high : close
pricesAvailable = not na(close) and not na(py) and not na(qy) and (not touching or low <= high)
numericalReady = (na(py) or geometry.coordinateSupported(py)) and (na(qy) or geometry.coordinateSupported(qy)) and (na(close) or geometry.coordinateSupported(close))
ready := ready and numericalReady
facts = array.new<ContactFact>()
endsOnOverlap = false
if ready and pricesAvailable and barstate.isconfirmed
    for edge = 0 to boundary.quadratic.size() - 1
        first = edge * 3
        ax = pointXs.get(first).value
        bx = pointXs.get(first + 1).value
        cx = pointXs.get(first + 2).value
        // Convex-hull rejection avoids exact arithmetic for distant parts of a long stroke.
        minX = boundary.quadratic.get(edge) ? math.min(ax, math.min(bx, cx)) : math.min(ax, cx)
        maxX = boundary.quadratic.get(edge) ? math.max(ax, math.max(bx, cx)) : math.max(ax, cx)
        if maxX < px or minX > qx
            continue
        ay = boundary.prices.get(first)
        by = boundary.prices.get(first + 1)
        cy = boundary.prices.get(first + 2)
        minY = boundary.quadratic.get(edge) ? math.min(ay, math.min(by, cy)) : math.min(ay, cy)
        maxY = boundary.quadratic.get(edge) ? math.max(ay, math.max(by, cy)) : math.max(ay, cy)
        if maxY < math.min(py, qy) or minY > math.max(py, qy)
            continue
        if touching
            points = geometry.rectangleContacts(ax, ay, bx, by, cx, cy, boundary.quadratic.get(edge), px, py, qx, qy)
            for point in points
                v = high == low ? 0.0 : (point.y - low) / (high - low)
                contactTime = time + (point.x - bar_index) * (time - time[1])
                facts.push(ContactFact.new(edge, v, contactTime, point.y))
            continue
        contacts = boundary.quadratic.get(edge) ? geometry.quadraticContacts(ax, ay, bx, by, cx, cy, px, py, qx, qy) : geometry.segmentContacts(ax, ay, cx, cy, px, py, qx, qy)
        for contact in contacts
            u = contact.boundaryParameter
            v = contact.observationParameter
            endsOnOverlap := endsOnOverlap or (contact.overlap and v == 1.0)
            accepted = false
            if not contact.overlap and v > 0.0
                if v == 1.0
                    accepted := true
                else if contact.transverse
                    if u > 0.0 and u < 1.0
                        accepted := true
                    else if u == 0.0 or u == 1.0
                        before = vertexSide(boundary, pointXs, u == 0.0 ? edge - 1 : edge, true, closed, px, py, qx, qy)
                        after = vertexSide(boundary, pointXs, u == 0.0 ? edge : edge + 1, false, closed, px, py, qx, qy)
                        accepted := (before < 0.0 and after > 0.0) or (before > 0.0 and after < 0.0)
            if accepted
                contactTime = time[1] + (time - time[1]) * v
                contactPrice = py + (qy - py) * v
                facts.push(ContactFact.new(edge, v, contactTime, contactPrice))

// An incident edge at Q is not a first arrival when the observation travelled
// along another edge into Q (including a rectangle corner).
if not touching and endsOnOverlap
    arrivalsRemoved = array.new<ContactFact>()
    for fact in facts
        if fact.observationParameter < 1.0
            arrivalsRemoved.push(fact)
    facts := arrivalsRemoved

emit "ready" ready ? 1.0 : 0.0
emit "value" close
alert("alert", barstate.isconfirmed and facts.size() > 0, "Drawing alert", "Price met its drawing condition", BoundaryOccurrence.new(touching ? "confirmed_range" : "confirmed_close", close, facts))
`;
