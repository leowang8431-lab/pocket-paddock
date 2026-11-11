import type { CircuitId } from './circuits';
import data from './travel-map-data.json';

type Point = readonly [number, number];
type View = readonly [number, number, number, number];
type Language = 'zh' | 'en';

export interface TravelOrigin {
  name: string;
  nameEn: string;
  location: Point;
  longFlight?: boolean;
}

export interface TravelDestination extends TravelOrigin {
  title: string;
  locale: string;
  country: string;
  admin: string;
  view: readonly [number, number, number];
}

export const DANZHOU: TravelOrigin = {
  name: '中国海南儋州', nameEn: 'Danzhou, Hainan, China', location: [109.58, 19.52], longFlight: true,
};

export const TRAVEL_DESTINATIONS: Record<CircuitId, TravelDestination> = {
  monza: {
    name: '蒙扎', nameEn: 'Monza', title: 'MONZA', locale: '蒙扎 · 意大利', country: '意大利',
    admin: 'Italy', location: [9.282, 45.618], view: [12.5, 42.3, 14.7],
  },
  spa: {
    name: '斯帕', nameEn: 'Spa', title: 'SPA-FRANCORCHAMPS', locale: '斯帕 · 比利时', country: '比利时',
    admin: 'Belgium', location: [5.971, 50.437], view: [4.62, 50.60, 4.8],
  },
  monaco: {
    name: '摩纳哥', nameEn: 'Monaco', title: 'MONACO', locale: '摩纳哥 · 蒙特卡洛', country: '摩纳哥公国',
    admin: 'Monaco', location: [7.426, 43.737], view: [7.418, 43.726, .16],
  },
};

export function flightDuration(from: TravelOrigin): number {
  return from.longFlight ? 2220 : 1810;
}

type Ring = readonly (readonly number[])[];
type Country = { name: string; rings: readonly Ring[] };

// Natural Earth land and country boundaries, reduced for the local bundle.
// Circuit outlines use samples from the playable tracks.
const { geography, outlines } = data;

function mapPath(rings: readonly Ring[]): Path2D {
  const path = new Path2D();
  for (const ring of rings) {
    path.moveTo(ring[0][0], ring[0][1]);
    for (let index = 1; index < ring.length; index++) {
      const [x, y] = ring[index];
      path.lineTo(x, y);
    }
    path.closePath();
  }
  return path;
}

function countryPaths(countries: readonly Country[]): Map<string, Path2D> {
  return new Map(countries.map(country => [country.name, mapPath(country.rings)]));
}

function createMapPaths() {
  return {
    land: mapPath(geography.land),
    europe: countryPaths(geography.europe),
    monacoCoast: countryPaths(geography.monacoCoast),
  };
}

let mapPaths: ReturnType<typeof createMapPaths> | undefined;

function sizeCanvas(canvas: HTMLCanvasElement) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return null;
  const ratio = Math.min(canvas.ownerDocument.defaultView?.devicePixelRatio || 1, 2);
  const pixelsWide = Math.round(width * ratio);
  const pixelsHigh = Math.round(height * ratio);
  if (canvas.width !== pixelsWide || canvas.height !== pixelsHigh) {
    canvas.width = pixelsWide;
    canvas.height = pixelsHigh;
  }
  return { width, height, ratio };
}

function unit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function ease(value: number): number {
  const fraction = unit(value);
  return fraction * fraction * (3 - 2 * fraction);
}

function interpolate(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function mixView(from: View, to: View, amount: number): View {
  return [
    interpolate(from[0], to[0], amount),
    interpolate(from[1], to[1], amount),
    from[2] * Math.pow(to[2] / from[2], amount),
    interpolate(from[3], to[3], amount),
  ];
}

function arcPoint(start: Point, bend: Point, end: Point, amount: number): Point {
  const rest = 1 - amount;
  return [
    rest * rest * start[0] + 2 * rest * amount * bend[0] + amount * amount * end[0],
    rest * rest * start[1] + 2 * rest * amount * bend[1] + amount * amount * end[1],
  ];
}

const planeOutline: readonly Point[] = [
  [14, 0], [9, -2], [1, -2], [-5, -11], [-8, -11], [-4, -2], [-10, -2], [-13, -6],
  [-15, -6], [-13, 0], [-15, 6], [-13, 6], [-10, 2], [-4, 2], [-8, 11], [-5, 11], [1, 2], [9, 2],
];

function drawPlane(ink: CanvasRenderingContext2D, position: Point, heading: number) {
  ink.save();
  ink.translate(...position);
  ink.rotate(heading);
  ink.fillStyle = '#fff4d7';
  ink.strokeStyle = '#13271e';
  ink.lineWidth = 2;
  ink.lineJoin = 'round';
  ink.shadowColor = '#ffe0a584';
  ink.shadowBlur = 9;
  ink.beginPath();
  ink.moveTo(...planeOutline[0]);
  for (let index = 1; index < planeOutline.length; index++) ink.lineTo(...planeOutline[index]);
  ink.closePath();
  ink.stroke();
  ink.fill();
  ink.restore();
}

function markLocation(ink: CanvasRenderingContext2D, [x, y]: Point, name: string, direction: number, emphasis: boolean) {
  ink.strokeStyle = emphasis ? '#ffd5a3' : '#b7d0bd';
  ink.lineWidth = 1.4;
  ink.fillStyle = emphasis ? '#ff6254' : '#304e3e';
  ink.beginPath();
  ink.arc(x, y, emphasis ? 4.6 : 3.7, 0, Math.PI * 2);
  ink.fill();
  ink.stroke();
  if (!name) return;
  ink.font = '600 12px "Microsoft YaHei UI", system-ui, sans-serif';
  ink.textAlign = direction < 0 ? 'right' : 'left';
  ink.textBaseline = 'middle';
  ink.lineWidth = 3.5;
  ink.strokeStyle = '#173127';
  ink.strokeText(name, x + direction * 11, y + 1);
  ink.fillStyle = emphasis ? '#fff3db' : '#d6e3d7';
  ink.fillText(name, x + direction * 11, y + 1);
}

export function createTravelMap(canvas: HTMLCanvasElement) {
  const ink = canvas.getContext('2d');

  function paint(from: TravelOrigin, to: TravelDestination, elapsed: number, language: Language) {
    if (!ink) return;
    const size = sizeCanvas(canvas);
    if (!size) return;
    const { width, height, ratio } = size;
    const paths = mapPaths ??= createMapPaths();
    const longFlight = from.longFlight === true;
    const towardRoute = ease((elapsed - 120) / 475);
    const approach = ease((elapsed - (longFlight ? 1530 : 1070)) / 500);
    const progress = ease((elapsed - (longFlight ? 270 : 370)) / (longFlight ? 1320 : 800));
    const world: View = [0, 9, Math.max(169, 345 * height / width), .88];
    const [start, finish] = [from.location, to.location];
    const routeView: View = longFlight
      ? [(start[0] + finish[0]) / 2, 37, Math.max(67, (Math.abs(start[0] - finish[0]) + 30) * .83 * height / width), .83]
      : [7, 47.2, 23, .68];
    const travelView = mixView(world, routeView, towardRoute);
    const [, , degrees, longitudeScale] = mixView(travelView, [...to.view, .72], approach);
    const centerAmount = 1 - (1 - approach) ** 2;
    const centerLon = interpolate(travelView[0], to.view[0], centerAmount);
    const centerLat = interpolate(travelView[1], to.view[1], centerAmount);
    const scale = height / degrees;
    const midX = width * interpolate(.5, .54, approach);
    const midY = height * interpolate(.5, .55, approach);
    const project = ([lon, lat]: Point): Point => [
      midX + (lon - centerLon) * scale * longitudeScale,
      midY - (lat - centerLat) * scale,
    ];

    ink.setTransform(ratio, 0, 0, ratio, 0, 0);
    ink.clearRect(0, 0, width, height);
    ink.save();
    ink.translate(...project([0, 0]));
    ink.scale(scale * longitudeScale, -scale);
    ink.lineJoin = 'round';
    const detail = longFlight ? ease((29 - degrees) / 14) : ease((towardRoute - .35) / .58);
    ink.globalAlpha = 1 - detail;
    ink.fillStyle = '#416555';
    ink.fill(paths.land, 'evenodd');
    ink.strokeStyle = '#729184';
    ink.lineWidth = .75 / scale;
    ink.stroke(paths.land);

    if (detail > 0) {
      const localDetail = to.admin === 'Monaco' ? ease((approach - .72) / .22) : 0;
      const drawCountry = (name: string, country: Path2D, opacity: number) => {
        const local = localDetail > 0 ? paths.monacoCoast.get(name) : undefined;
        ink.globalAlpha = local ? opacity * (1 - localDetail) : opacity;
        ink.fill(country, 'evenodd');
        ink.stroke(country);
        if (local) {
          ink.globalAlpha = opacity * localDetail;
          ink.fill(local, 'evenodd');
          ink.stroke(local);
        }
      };
      ink.fillStyle = '#426857';
      ink.strokeStyle = '#779487';
      ink.lineWidth = .78 / scale;
      for (const [name, country] of paths.europe) drawCountry(name, country, detail);
      const destination = paths.europe.get(to.admin);
      if (destination) {
        ink.fillStyle = '#b9ab77';
        ink.strokeStyle = '#ffe5ae';
        ink.lineWidth = 1.25 / scale;
        drawCountry(to.admin, destination, detail * ease((elapsed - 760) / 410));
      }
    }
    ink.restore();

    const bend: Point = longFlight
      ? [(start[0] + finish[0]) / 2, Math.max(start[1], finish[1]) + 15]
      : [(start[0] + finish[0]) / 2 + (finish[1] - start[1]) * .36,
        (start[1] + finish[1]) / 2 - (finish[0] - start[0]) * .32];
    const traceArc = (amount: number) => {
      const steps = Math.max(1, Math.ceil(amount * 30));
      ink.beginPath();
      ink.moveTo(...project(start));
      for (let step = 1; step <= steps; step++) {
        ink.lineTo(...project(arcPoint(start, bend, finish, amount * step / steps)));
      }
    };

    ink.save();
    ink.globalAlpha = 1 - ease((approach - .16) / .61);
    ink.strokeStyle = '#e3d8b3af';
    ink.lineWidth = 1.2;
    ink.setLineDash([3, 5]);
    traceArc(1);
    ink.stroke();
    ink.setLineDash([]);
    ink.strokeStyle = '#fbd48b';
    ink.lineWidth = 2;
    traceArc(progress);
    ink.stroke();
    const showNames = longFlight || towardRoute > .8;
    const startName = language === 'en' ? from.nameEn : from.name;
    const finishName = language === 'en' ? to.nameEn : to.name;
    markLocation(ink, project(start), showNames ? startName : '', longFlight || start[0] < finish[0] ? -1 : 1, false);
    ink.restore();

    markLocation(ink, project(finish), showNames ? finishName : '', approach > .45 || start[0] < finish[0] ? 1 : -1, true);
    const position = project(arcPoint(start, bend, finish, progress));
    const before = project(arcPoint(start, bend, finish, Math.max(0, progress - .005)));
    const after = project(arcPoint(start, bend, finish, Math.min(1, progress + .005)));
    ink.save();
    ink.globalAlpha = 1 - ease((approach - .1) / .65);
    drawPlane(ink, position, Math.atan2(after[1] - before[1], after[0] - before[0]));
    ink.restore();
  }

  return { paint };
}

function projectCircuit(circuit: CircuitId, width: number, height: number) {
  const outline = outlines[circuit];
  const xs = outline.map(point => point[0]);
  const ys = outline.map(point => point[1]);
  const left = Math.min(...xs), right = Math.max(...xs);
  const top = Math.min(...ys), bottom = Math.max(...ys);
  const scale = Math.min(width * .88 / (right - left), height * .84 / (bottom - top));
  const points = [...outline, outline[0]].map(([x, y]): Point => [
    width / 2 + (x - (left + right) / 2) * scale,
    height / 2 + (y - (top + bottom) / 2) * scale,
  ]);
  const background = new Path2D();
  background.moveTo(...points[0]);
  for (let index = 1; index < points.length; index++) background.lineTo(...points[index]);
  return { circuit, width, height, points, background };
}

const circuitProjections = new WeakMap<HTMLCanvasElement, ReturnType<typeof projectCircuit>>();

export function paintCircuitOutline(canvas: HTMLCanvasElement, circuit: CircuitId, fraction: number) {
  const ink = canvas.getContext('2d');
  if (!ink) return;
  const size = sizeCanvas(canvas);
  if (!size) return;
  const { width, height, ratio } = size;
  let projection = circuitProjections.get(canvas);
  if (projection?.circuit !== circuit || projection.width !== width || projection.height !== height) {
    projection = projectCircuit(circuit, width, height);
    circuitProjections.set(canvas, projection);
  }

  const { points, background } = projection;
  ink.setTransform(ratio, 0, 0, ratio, 0, 0);
  ink.clearRect(0, 0, width, height);
  ink.lineJoin = 'round';
  ink.lineCap = 'round';
  ink.strokeStyle = '#a1c1a95e';
  ink.lineWidth = 2;
  ink.stroke(background);

  const index = unit(fraction) * (points.length - 1);
  const end = Math.floor(index);
  const from = points[end], to = points[Math.ceil(index)];
  const nose: Point = [interpolate(from[0], to[0], index % 1), interpolate(from[1], to[1], index % 1)];
  ink.beginPath();
  ink.moveTo(...points[0]);
  for (let step = 1; step <= end; step++) ink.lineTo(...points[step]);
  ink.lineTo(...nose);
  ink.strokeStyle = '#fff1d7';
  ink.lineWidth = width > 300 ? 4 : 3;
  ink.stroke();
  ink.fillStyle = '#ff6356';
  ink.beginPath();
  ink.arc(...nose, 4.8, 0, Math.PI * 2);
  ink.fill();
}
