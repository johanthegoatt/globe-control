import crypto from "node:crypto";
import { config } from "../config.js";
import { getMaxMindData } from "./maxmind.js";

const DISTANCE_KM = 6371;
const DATACENTER_KEYWORDS = [
  "amazon",
  "aws",
  "google",
  "microsoft",
  "digitalocean",
  "linode",
  "ovh",
  "vultr",
  "colo",
  "datacenter"
];

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * DISTANCE_KM * Math.asin(Math.sqrt(a));
}

function getDatacenterSignal(asnName = "") {
  const normalized = String(asnName).toLowerCase();
  return DATACENTER_KEYWORDS.some((k) => normalized.includes(k));
}

function scoreDistance(distanceKm) {
  if (distanceKm == null) return 8;
  if (distanceKm > 3000) return 42;
  if (distanceKm > 1500) return 28;
  if (distanceKm > 700) return 16;
  if (distanceKm > 300) return 8;
  return 0;
}

function scoreAccuracy(accuracyM) {
  if (accuracyM == null) return 8;
  if (accuracyM > 3500) return 22;
  if (accuracyM > 2000) return 16;
  if (accuracyM > 1000) return 10;
  if (accuracyM > 500) return 6;
  return 0;
}

function parseClientIp(req) {
  return String(req.ip || "").replace("::ffff:", "");
}

function hashIp(ip) {
  return crypto.createHash("sha256").update(`${config.ipHashSalt}:${ip}`).digest("hex");
}

function roundCoarse(v) {
  return Math.round(v * 100) / 100;
}

export async function evaluateLocationRisk(req, geo) {
  const ip = parseClientIp(req);
  const ipHash = hashIp(ip);
  const maxmind = await getMaxMindData(ip);

  const ipLat = maxmind.city?.location?.latitude ?? null;
  const ipLng = maxmind.city?.location?.longitude ?? null;
  const distanceKm = ipLat == null || ipLng == null ? null : haversineKm(geo.lat, geo.lng, ipLat, ipLng);

  const trait = maxmind.city?.traits || {};
  const isDatacenter = getDatacenterSignal(maxmind.asn?.autonomous_system_organization);

  const reasons = [];
  let score = 0;

  if (isDatacenter) {
    score += 34;
    reasons.push("ASN_DATACENTER");
  }
  if (trait.is_anonymous_proxy || trait.is_public_proxy || trait.is_tor_exit_node) {
    score += 38;
    reasons.push("PROXY_SUSPECTED");
  }
  const distanceScore = scoreDistance(distanceKm);
  score += distanceScore;
  if (distanceScore >= 16) reasons.push("GEO_MISMATCH_HIGH");

  const accuracyScore = scoreAccuracy(geo.accuracy);
  score += accuracyScore;
  if (accuracyScore >= 16) reasons.push("LOW_CONFIDENCE");

  const trustLevel = Math.max(0, Math.min(100, 100 - score));
  return {
    ipHash,
    coarseLat: roundCoarse(geo.lat),
    coarseLng: roundCoarse(geo.lng),
    riskScore: Math.max(0, Math.min(100, score)),
    trustLevel,
    reasonCodes: reasons,
    signals: {
      ip,
      ipLat,
      ipLng,
      distanceKm,
      browserAccuracyM: geo.accuracy ?? null,
      asn: maxmind.asn?.autonomous_system_number ?? null,
      asnOrg: maxmind.asn?.autonomous_system_organization ?? null,
      trait: {
        isAnonymousProxy: Boolean(trait.is_anonymous_proxy),
        isPublicProxy: Boolean(trait.is_public_proxy),
        isTorExitNode: Boolean(trait.is_tor_exit_node)
      }
    }
  };
}
