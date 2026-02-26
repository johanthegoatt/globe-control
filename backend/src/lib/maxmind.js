import maxmind from "maxmind";
import { config } from "../config.js";

let cityReaderPromise = null;
let asnReaderPromise = null;

async function openReader(path) {
  try {
    return await maxmind.open(path);
  } catch {
    return null;
  }
}

export async function getCityReader() {
  if (!cityReaderPromise) {
    cityReaderPromise = openReader(config.maxmindCityDbPath);
  }
  return cityReaderPromise;
}

export async function getAsnReader() {
  if (!asnReaderPromise) {
    asnReaderPromise = openReader(config.maxmindAsnDbPath);
  }
  return asnReaderPromise;
}

export async function getMaxMindData(ip) {
  const [cityReader, asnReader] = await Promise.all([getCityReader(), getAsnReader()]);
  const city = cityReader?.get(ip) || null;
  const asn = asnReader?.get(ip) || null;
  return { city, asn };
}
