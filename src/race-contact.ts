/** One horizontal footprint shared by the player and all rivals. It closely
 * fits the supplied model, which measures 2.32 × 4.73 at its driving scale. */
export const RACE_CAR_HALF_WIDTH = 1.2;
export const RACE_CAR_HALF_LENGTH = 2.36;

export interface RaceContactBody {
  x: number;
  z: number;
  heading: number;
  vx: number;
  vz: number;
  yawRate?: number;
}

const halfWidth = RACE_CAR_HALF_WIDTH;
const halfLength = RACE_CAR_HALF_LENGTH;
const radiusSquared = halfWidth * halfWidth + halfLength * halfLength;
const inverseInertia = 3 / radiusSquared;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Resolve an overlap between equal-mass cars and return the impact speed
 * along the contact normal. Separating cars receive only position correction.
 * The caller owns the scalar speed and derives it from the new velocity. */
export function resolveRaceContact(a: RaceContactBody, b: RaceContactBody, dt: number): number {
  if (a === b || !Number.isFinite(dt) || dt <= 0) return 0;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  if (!(dx * dx + dz * dz < 4 * radiusSquared)) return 0;

  const afx = Math.sin(a.heading), afz = Math.cos(a.heading);
  const bfx = Math.sin(b.heading), bfz = Math.cos(b.heading);
  const aAlong = dx * afx + dz * afz;
  const aAcross = dx * afz - dz * afx;
  const bAlong = dx * bfx + dz * bfz;
  const bAcross = dx * bfz - dz * bfx;
  const parallel = Math.abs(afx * bfx + afz * bfz);
  const crossed = Math.abs(afx * bfz - afz * bfx);
  const projectedLength = halfLength * parallel + halfWidth * crossed;
  const projectedWidth = halfLength * crossed + halfWidth * parallel;

  // A rectangle pair can separate on either car's forward or right axis.
  const aFrontOverlap = halfLength + projectedLength - Math.abs(aAlong);
  const aSideOverlap = halfWidth + projectedWidth - Math.abs(aAcross);
  const bFrontOverlap = halfLength + projectedLength - Math.abs(bAlong);
  const bSideOverlap = halfWidth + projectedWidth - Math.abs(bAcross);
  const depth = Math.min(aFrontOverlap, aSideOverlap, bFrontOverlap, bSideOverlap);
  if (!(depth > 0)) return 0;

  const referenceIsA = depth === aFrontOverlap || depth === aSideOverlap;
  const frontFace = depth === (referenceIsA ? aFrontOverlap : bFrontOverlap);
  const fx = referenceIsA ? afx : bfx, fz = referenceIsA ? afz : bfz;
  const axisX = frontFace ? fx : fz, axisZ = frontFace ? fz : -fx;
  const direction = dx * axisX + dz * axisZ < 0 ? -1 : 1;
  const nx = direction * axisX, nz = direction * axisZ;
  const referenceDirection = referenceIsA ? 1 : -1;
  const contact = clipContactPoint(referenceIsA ? a : b, referenceIsA ? b : a,
    nx * referenceDirection, nz * referenceDirection, frontFace, referenceIsA ? bfx : afx, referenceIsA ? bfz : afz);

  // Correct the pose without changing velocity or the centre of mass. The
  // impulse then uses the corrected centres and one shared point of action.
  const separation = Math.min(Math.max(0, depth - .006) * .85, .12 + Math.min(dt, .05) * 4) * .5;
  a.x -= nx * separation;
  a.z -= nz * separation;
  b.x += nx * separation;
  b.z += nz * separation;

  return applyContactImpulse(a, b, nx, nz, contact.x, contact.z, .16, .32);
}

/** Clip the incident edge to the reference face's side planes and keep only
 * the portion inside the reference face. Average the resulting contact patch. */
function clipContactPoint(reference: RaceContactBody, incident: RaceContactBody, nx: number, nz: number,
  frontFace: boolean, incidentFx: number, incidentFz: number): {x: number; z: number} {
  const refHalfDepth = frontFace ? halfLength : halfWidth;
  const refHalfSpan = frontFace ? halfWidth : halfLength;
  const refX = reference.x + nx * refHalfDepth, refZ = reference.z + nz * refHalfDepth;
  const incidentFront = Math.abs(incidentFx * nx + incidentFz * nz) >= Math.abs(incidentFz * nx - incidentFx * nz);
  const ix = incidentFront ? incidentFx : incidentFz, iz = incidentFront ? incidentFz : -incidentFx;
  const edgeDepth = incidentFront ? halfLength : halfWidth;
  const edgeHalfSpan = incidentFront ? halfWidth : halfLength;
  const incidentDirection = ix * nx + iz * nz > 0 ? -1 : 1;
  const edgeX = incident.x + ix * edgeDepth * incidentDirection;
  const edgeZ = incident.z + iz * edgeDepth * incidentDirection;
  const ex = iz, ez = -ix;
  const offsetX = edgeX - refX, offsetZ = edgeZ - refZ;
  const tangentOffset = offsetX * nz - offsetZ * nx;
  const tangentSlope = ex * nz - ez * nx;
  const normalOffset = offsetX * nx + offsetZ * nz;
  const normalSlope = ex * nx + ez * nz;
  const clipA = (-refHalfSpan - tangentOffset) / tangentSlope;
  const clipB = (refHalfSpan - tangentOffset) / tangentSlope;
  let low = Math.max(-edgeHalfSpan, Math.min(clipA, clipB));
  let high = Math.min(edgeHalfSpan, Math.max(clipA, clipB));
  if (normalSlope > 1e-9) high = Math.min(high, -normalOffset / normalSlope);
  if (normalSlope < -1e-9) low = Math.max(low, -normalOffset / normalSlope);
  const t = clamp((low + high) * .5, -edgeHalfSpan, edgeHalfSpan);
  const halfGap = (normalOffset + normalSlope * t) * .5;
  return {x: edgeX + ex * t - nx * halfGap, z: edgeZ + ez * t - nz * halfGap};
}

/** Apply an impulse from an immovable wall with an outward unit normal. */
export function resolveWallImpulse(body: RaceContactBody, nx: number, nz: number, contactX: number, contactZ: number): number {
  return applyContactImpulse(undefined, body, nx, nz, contactX, contactZ, .12, .42);
}

function applyContactImpulse(a: RaceContactBody | undefined, b: RaceContactBody, nx: number, nz: number,
  contactX: number, contactZ: number, restitution: number, friction: number): number {
  const rax = a ? contactX - a.x : 0, raz = a ? contactZ - a.z : 0;
  const rbx = contactX - b.x, rbz = contactZ - b.z;
  const yawA = a?.yawRate ?? 0, yawB = b.yawRate ?? 0;
  const relativeX = b.vx + yawB * rbz - (a?.vx ?? 0) - yawA * raz;
  const relativeZ = b.vz - yawB * rbx - (a?.vz ?? 0) + yawA * rax;
  const impactSpeed = -(relativeX * nx + relativeZ * nz);
  if (!Number.isFinite(impactSpeed) || impactSpeed <= 0) return 0;

  const tx = -nz, tz = nx, tangentSpeed = relativeX * tx + relativeZ * tz;
  const inertiaA = a?.yawRate === undefined ? 0 : inverseInertia;
  const inertiaB = b.yawRate === undefined ? 0 : inverseInertia;
  // Heading rotates the +z forward vector toward +x.
  const normalLeverA = raz * nx - rax * nz;
  const normalLeverB = rbz * nx - rbx * nz;
  const tangentLeverA = raz * tx - rax * tz;
  const tangentLeverB = rbz * tx - rbx * tz;
  const inverseMass = a ? 2 : 1;
  const kn = inverseMass + inertiaA * normalLeverA ** 2 + inertiaB * normalLeverB ** 2;
  const kt = inverseMass + inertiaA * tangentLeverA ** 2 + inertiaB * tangentLeverB ** 2;
  const knt = inertiaA * normalLeverA * tangentLeverA + inertiaB * normalLeverB * tangentLeverB;
  const bounce = impactSpeed > 2 ? restitution : 0;
  const normalChange = (1 + bounce) * impactSpeed;

  // Solve the normal and tangent together. Clipping the sticking solution to
  // the Coulomb cone then re-solving the normal keeps the same restitution.
  const frictionlessNormal = normalChange / kn;
  const slip = tangentSpeed + knt * frictionlessNormal;
  const tangentResponse = kt - knt * knt / kn;
  let tangentImpulse = -slip / tangentResponse;
  let normalImpulse = (normalChange - knt * tangentImpulse) / kn;
  if (Math.abs(tangentImpulse) > friction * normalImpulse) {
    const slidingRatio = -Math.sign(slip) * friction;
    const slidingResponse = kn + knt * slidingRatio;
    normalImpulse = slidingResponse > 0 ? normalChange / slidingResponse : frictionlessNormal;
    tangentImpulse = slidingResponse > 0 ? slidingRatio * normalImpulse : 0;
  }

  // A rebound coupled with friction can demand positive work in degenerate
  // geometries. Keep the passive normal rebound in that case.
  const finalTangentSpeed = tangentSpeed + knt * normalImpulse + kt * tangentImpulse;
  const energyChange = .5 * ((bounce - 1) * impactSpeed * normalImpulse + (tangentSpeed + finalTangentSpeed) * tangentImpulse);
  if (energyChange > 0 || normalImpulse < 0) {
    normalImpulse = frictionlessNormal;
    tangentImpulse = 0;
  }
  const impulseX = nx * normalImpulse + tx * tangentImpulse;
  const impulseZ = nz * normalImpulse + tz * tangentImpulse;

  if (a) {
    a.vx -= impulseX;
    a.vz -= impulseZ;
    if (a.yawRate !== undefined) a.yawRate = yawA - inertiaA * (raz * impulseX - rax * impulseZ);
  }
  b.vx += impulseX;
  b.vz += impulseZ;
  if (b.yawRate !== undefined) b.yawRate = yawB + inertiaB * (rbz * impulseX - rbx * impulseZ);
  return impactSpeed;
}
